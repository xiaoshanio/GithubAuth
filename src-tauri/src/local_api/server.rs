use std::{
    net::{IpAddr, Ipv4Addr},
    sync::{atomic::Ordering, Arc},
    time::Duration,
};

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Extension, State},
    http::{Request, StatusCode},
    response::{IntoResponse, Response},
    routing::{any, get, post},
    Json, Router,
};
use chrono::{Duration as ChronoDuration, Utc};
use hyper::server::conn::http1;
use hyper_util::{rt::TokioIo, service::TowerToHyperService};
use rcgen::CertificateSigningRequestParams;
use serde::{de::DeserializeOwned, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{net::TcpListener, sync::Semaphore, time::timeout};
use tokio_rustls::TlsAcceptor;
use tower_http::timeout::TimeoutLayer;
use uuid::Uuid;

use crate::{persist_session_payload, state_lock, AppSecurityState};

use super::{
    audit::{self, AuditContext},
    envelope::{decode_x25519_public, decrypt_request, encrypt_response},
    focus_main_window,
    models::{
        AccountRequestBody, ClientApplication, EncryptedEnvelope, ExportAccountPreview,
        ImportRequestBody, PairingRequestBody, PendingApiExport, PendingApiImport, PendingPairing,
        StatusRequestBody, LOCAL_API_PORT, MAX_REQUEST_BYTES, PENDING_TTL_SECONDS,
        PROTOCOL_VERSION,
    },
    notify_state_changed,
    permissions::{
        account_scope_valid, active_client, active_key, application_matches, unbound_key,
        validate_application,
    },
    tls::{connection_info, ConnectionInfo},
    windows_identity, LocalApiRuntime, PendingExportRecord, PendingImportRecord,
    PendingPairingRecord, ReceiptKind, RequestReceipt,
};

const MAX_CONNECTIONS: usize = 64;
const TLS_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
const CONNECTION_TIMEOUT: Duration = Duration::from_secs(30);
const PAIRING_ROUTE: &str = "/v2/pairing-requests";
const PAIRING_STATUS_ROUTE: &str = "/v2/pairing-status";
const IMPORT_ROUTE: &str = "/v2/import-requests";
const ACCOUNT_ROUTE: &str = "/v2/account-requests";
const STATUS_ROUTE: &str = "/v2/request-status";

#[derive(Clone)]
struct ApiState {
    app: AppHandle,
}

pub async fn run(app: AppHandle) {
    let runtime = app.state::<LocalApiRuntime>();
    let listener = match TcpListener::bind((Ipv4Addr::LOCALHOST, LOCAL_API_PORT)).await {
        Ok(listener) => listener,
        Err(_) => {
            runtime.listening.store(false, Ordering::SeqCst);
            let _ = app.emit(
                "local-api-runtime-error",
                "The encrypted local API port is unavailable",
            );
            return;
        }
    };
    runtime.listening.store(true, Ordering::SeqCst);
    let cleanup_app = app.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(15));
        loop {
            interval.tick().await;
            let runtime = cleanup_app.state::<LocalApiRuntime>();
            let changed = runtime
                .inner
                .lock()
                .map(|mut inner| inner.prune_expired())
                .unwrap_or(false);
            if changed {
                notify_state_changed(&cleanup_app);
            }
        }
    });
    let semaphore = Arc::new(Semaphore::new(MAX_CONNECTIONS));
    let router = routes(app.clone());

    loop {
        let (socket, remote_address) = match listener.accept().await {
            Ok(value) => value,
            Err(_) => continue,
        };
        if remote_address.ip() != IpAddr::V4(Ipv4Addr::LOCALHOST) {
            continue;
        }
        let permit = match semaphore.clone().try_acquire_owned() {
            Ok(permit) => permit,
            Err(_) => continue,
        };
        let tls_config = match runtime.current_tls_config() {
            Ok(config) => config,
            Err(_) => continue,
        };
        let acceptor = TlsAcceptor::from(tls_config);
        let service = router.clone();
        tokio::spawn(async move {
            let _permit = permit;
            let stream = match timeout(TLS_HANDSHAKE_TIMEOUT, acceptor.accept(socket)).await {
                Ok(Ok(stream)) => stream,
                _ => return,
            };
            let info = connection_info(&stream, remote_address);
            let service = service.layer(Extension(info));
            let service = TowerToHyperService::new(service);
            let connection = http1::Builder::new()
                .keep_alive(false)
                .serve_connection(TokioIo::new(stream), service);
            let _ = timeout(CONNECTION_TIMEOUT, connection).await;
        });
    }
}

fn routes(app: AppHandle) -> Router {
    Router::new()
        .route("/health", get(health))
        .route(PAIRING_ROUTE, post(pairing_request))
        .route(PAIRING_STATUS_ROUTE, post(pairing_status))
        .route(IMPORT_ROUTE, post(import_request))
        .route(ACCOUNT_ROUTE, post(account_request))
        .route(STATUS_ROUTE, post(request_status))
        .route("/v1/{*path}", any(upgrade_required))
        .fallback(not_found)
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(15),
        ))
        .with_state(ApiState { app })
}

async fn health() -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(serde_json::json!({
            "name": "Github Auth Local API",
            "status": "ready",
            "protocolVersion": PROTOCOL_VERSION,
            "tls": "1.3"
        })),
    )
}

async fn upgrade_required() -> impl IntoResponse {
    (
        StatusCode::UPGRADE_REQUIRED,
        Json(serde_json::json!({
            "error": "Sensitive v1 endpoints are disabled; pair a client and use encrypted v2"
        })),
    )
}

#[cfg(test)]
fn route_policy(method: &str, path: &str) -> u16 {
    match (method, path) {
        ("GET", "/health") => 200,
        (_, value) if value.starts_with("/v1/") => 426,
        _ => 404,
    }
}

async fn not_found(_request: Request<Body>) -> impl IntoResponse {
    json_error(StatusCode::NOT_FOUND, "Not found")
}

async fn pairing_request(
    State(state): State<ApiState>,
    Extension(connection): Extension<ConnectionInfo>,
    Json(envelope): Json<EncryptedEnvelope>,
) -> Response {
    let runtime = state.app.state::<LocalApiRuntime>();
    let identity = match runtime.current_identity() {
        Ok(value) => value,
        Err(error) => return json_error(StatusCode::SERVICE_UNAVAILABLE, &error),
    };
    let body = match decrypt::<PairingRequestBody>(&runtime, &identity, &envelope, PAIRING_ROUTE) {
        Ok(value) => value,
        Err(error) => return json_error(StatusCode::BAD_REQUEST, &error),
    };
    if Uuid::parse_str(&envelope.client_id).is_err() {
        return json_error(StatusCode::UNPROCESSABLE_ENTITY, "clientId must be a UUID");
    }
    if let Err(error) = validate_application(&body.application) {
        return json_error(StatusCode::UNPROCESSABLE_ENTITY, &error);
    }
    if body.purpose.trim().is_empty() || body.purpose.len() > 2_000 {
        return json_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "A valid purpose is required",
        );
    }
    if !body.allow_import && !body.allow_read {
        return json_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "At least one permission must be requested",
        );
    }
    if CertificateSigningRequestParams::from_pem(&body.client_csr).is_err() {
        return json_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "The client CSR is invalid",
        );
    }
    let encryption_public_key = match decode_x25519_public(&body.encryption_public_key) {
        Ok(value) => value,
        Err(error) => return json_error(StatusCode::UNPROCESSABLE_ENTITY, &error),
    };
    if !x25519_dalek::StaticSecret::random_from_rng(rand::rngs::OsRng)
        .diffie_hellman(&x25519_dalek::PublicKey::from(encryption_public_key))
        .was_contributory()
    {
        return json_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "The client X25519 key is invalid",
        );
    }

    let security_state = state.app.state::<AppSecurityState>();
    let security = match state_lock(&security_state) {
        Ok(value) => value,
        Err(error) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    let Some(session) = security.unlocked.as_ref() else {
        return json_error(StatusCode::LOCKED, "Github Auth is locked");
    };
    if session
        .payload
        .local_api
        .clients
        .iter()
        .any(|client| client.id == envelope.client_id)
    {
        return json_error(StatusCode::CONFLICT, "This clientId is already paired");
    }
    let (group_id, group_name, api_key_id) = if body.allow_read {
        let Some(group_id) = body.group_id.as_deref() else {
            return json_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Read permission requires a group",
            );
        };
        let Some(key_id) = body.key_id.as_deref() else {
            return json_error(
                StatusCode::UNAUTHORIZED,
                "Read permission requires an API key",
            );
        };
        let Some(key_secret) = body.key_secret.as_deref() else {
            return json_error(
                StatusCode::UNAUTHORIZED,
                "Read permission requires an API key",
            );
        };
        if let Err(error) = unbound_key(&session.payload.local_api, key_id, key_secret, group_id) {
            return json_error(StatusCode::UNAUTHORIZED, &error);
        }
        let Some(group) = session
            .payload
            .groups
            .iter()
            .find(|group| group.id == group_id)
        else {
            return json_error(
                StatusCode::FORBIDDEN,
                "The requested group no longer exists",
            );
        };
        (
            Some(group_id.to_string()),
            Some(group.name.clone()),
            Some(key_id.to_string()),
        )
    } else {
        (None, None, None)
    };
    drop(security);

    let caller = windows_identity::inspect(connection.remote_address, &body.application);
    let preview = PendingPairing {
        id: envelope.request_id.clone(),
        client_id: envelope.client_id.clone(),
        application: body.application.clone(),
        purpose: body.purpose.clone(),
        allow_import: body.allow_import,
        allow_read: body.allow_read,
        group_id,
        group_name,
        requested_at: Utc::now().to_rfc3339(),
        remote_address: connection.remote_address.to_string(),
        source_pid: caller.source_pid,
        executable_path: caller.executable_path,
        executable_sha256: caller.executable_sha256,
        authenticode_publisher: caller.authenticode_publisher,
        signature_status: caller.signature_status,
    };
    let mut inner = match runtime.inner.lock() {
        Ok(value) => value,
        Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "Runtime unavailable"),
    };
    if pending_count(&inner) >= 25 {
        return json_error(StatusCode::TOO_MANY_REQUESTS, "Too many pending requests");
    }
    inner.pairings.insert(
        preview.id.clone(),
        PendingPairingRecord {
            preview: preview.clone(),
            csr_pem: body.client_csr.clone(),
            encryption_public_key,
            api_key_id,
        },
    );
    inner.receipts.insert(
        preview.id.clone(),
        pending_receipt(
            &preview.id,
            &preview.client_id,
            ReceiptKind::Pairing,
            None,
            preview.group_id.clone(),
        ),
    );
    drop(inner);
    focus_main_window(&state.app);
    let _ = state.app.emit("local-api-pairing-request", &preview);
    notify_state_changed(&state.app);
    encrypted_accepted(
        &identity,
        &preview.client_id,
        &preview.id,
        encryption_public_key,
        serde_json::json!({
            "requestId": preview.id,
            "status": "pending",
            "statusEndpoint": "https://127.0.0.1:46329/v2/pairing-status"
        }),
    )
}

async fn import_request(
    State(state): State<ApiState>,
    Extension(connection): Extension<ConnectionInfo>,
    Json(envelope): Json<EncryptedEnvelope>,
) -> Response {
    let runtime = state.app.state::<LocalApiRuntime>();
    let identity = match runtime.current_identity() {
        Ok(value) => value,
        Err(error) => return json_error(StatusCode::SERVICE_UNAVAILABLE, &error),
    };
    let security_state = state.app.state::<AppSecurityState>();
    let mut security = match state_lock(&security_state) {
        Ok(value) => value,
        Err(error) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    let Some(session) = security.unlocked.as_mut() else {
        return json_error(
            StatusCode::LOCKED,
            "Github Auth is locked; retry after it is unlocked",
        );
    };
    let client = match active_client(
        &session.payload.local_api,
        &envelope.client_id,
        connection.certificate_fingerprint.as_deref(),
    ) {
        Ok(value) if value.allow_import => value.clone(),
        Ok(_) => return json_error(StatusCode::FORBIDDEN, "This client may not import accounts"),
        Err(error) => return json_error(StatusCode::UNAUTHORIZED, &error),
    };
    let body = match decrypt::<ImportRequestBody>(&runtime, &identity, &envelope, IMPORT_ROUTE) {
        Ok(value) => value,
        Err(error) => return json_error(StatusCode::BAD_REQUEST, &error),
    };
    if !application_matches(&client, &body.application) {
        append_server_audit(
            &state.app,
            session,
            IMPORT_ROUTE,
            "import_request",
            "blocked",
            &body.application,
            Some(&client),
            None,
            None,
            body.accounts.len(),
            None,
            &connection.remote_address.to_string(),
            Some(envelope.request_id.clone()),
            "The software identity did not match its pairing",
        );
        return json_error(
            StatusCode::FORBIDDEN,
            "The software identity does not match its pairing",
        );
    }
    let caller = windows_identity::inspect(connection.remote_address, &body.application);
    if !windows_identity::verified_caller_matches(&client, &caller) {
        append_server_audit(
            &state.app,
            session,
            IMPORT_ROUTE,
            "import_request",
            "blocked",
            &body.application,
            Some(&client),
            None,
            None,
            body.accounts.len(),
            caller.source_pid,
            &connection.remote_address.to_string(),
            Some(envelope.request_id.clone()),
            "The verified executable identity changed since pairing",
        );
        return json_error(
            StatusCode::FORBIDDEN,
            "The verified executable identity changed since pairing",
        );
    }
    if let Err(error) = validate_import(&body) {
        append_server_audit(
            &state.app,
            session,
            IMPORT_ROUTE,
            "import_request",
            "failed",
            &body.application,
            Some(&client),
            None,
            None,
            body.accounts.len(),
            caller.source_pid,
            &connection.remote_address.to_string(),
            Some(envelope.request_id.clone()),
            &error,
        );
        return json_error(StatusCode::UNPROCESSABLE_ENTITY, &error);
    }
    let preview = PendingApiImport {
        id: envelope.request_id.clone(),
        client_id: envelope.client_id.clone(),
        application: body.application.clone(),
        purpose: body.purpose.clone(),
        accounts: body.accounts.clone(),
        requested_at: Utc::now().to_rfc3339(),
        remote_address: connection.remote_address.to_string(),
        source_pid: caller.source_pid,
        executable_sha256: caller.executable_sha256.clone(),
        authenticode_publisher: caller.authenticode_publisher.clone(),
        signature_status: caller.signature_status.clone(),
    };
    audit::append(
        &mut session.payload.local_api,
        AuditContext {
            route: IMPORT_ROUTE,
            action: "import_request",
            outcome: "pending",
            application: &preview.application,
            client: Some(&client),
            api_key_name: None,
            group_id: None,
            account_count: preview.accounts.len(),
            source_pid: preview.source_pid,
            remote_address: &preview.remote_address,
            request_id: Some(preview.id.clone()),
            detail: "Encrypted import request is waiting for user approval".to_string(),
        },
    );
    if let Err(error) = persist_session_payload(&state.app, session) {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, &error);
    }
    drop(security);

    let mut inner = match runtime.inner.lock() {
        Ok(value) => value,
        Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "Runtime unavailable"),
    };
    if pending_count(&inner) >= 25 {
        return json_error(StatusCode::TOO_MANY_REQUESTS, "Too many pending requests");
    }
    inner.imports.insert(
        preview.id.clone(),
        PendingImportRecord {
            envelope: envelope.clone(),
            remote_address: preview.remote_address.clone(),
            source_pid: preview.source_pid,
            executable_sha256: preview.executable_sha256.clone(),
            authenticode_publisher: preview.authenticode_publisher.clone(),
            signature_status: preview.signature_status.clone(),
        },
    );
    inner.receipts.insert(
        preview.id.clone(),
        pending_receipt(
            &preview.id,
            &preview.client_id,
            ReceiptKind::Import,
            None,
            None,
        ),
    );
    drop(inner);
    focus_main_window(&state.app);
    let _ = state.app.emit("local-api-import-request", &preview);
    notify_state_changed(&state.app);
    let client_public = match decode_x25519_public(&client.encryption_public_key) {
        Ok(value) => value,
        Err(error) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    encrypted_accepted(
        &identity,
        &preview.client_id,
        &preview.id,
        client_public,
        serde_json::json!({
            "requestId": preview.id,
            "status": "pending",
            "statusEndpoint": "https://127.0.0.1:46329/v2/request-status"
        }),
    )
}

async fn account_request(
    State(state): State<ApiState>,
    Extension(connection): Extension<ConnectionInfo>,
    Json(envelope): Json<EncryptedEnvelope>,
) -> Response {
    let runtime = state.app.state::<LocalApiRuntime>();
    let identity = match runtime.current_identity() {
        Ok(value) => value,
        Err(error) => return json_error(StatusCode::SERVICE_UNAVAILABLE, &error),
    };
    let security_state = state.app.state::<AppSecurityState>();
    let mut security = match state_lock(&security_state) {
        Ok(value) => value,
        Err(error) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    let Some(session) = security.unlocked.as_mut() else {
        return json_error(StatusCode::LOCKED, "Github Auth is locked");
    };
    let client = match active_client(
        &session.payload.local_api,
        &envelope.client_id,
        connection.certificate_fingerprint.as_deref(),
    ) {
        Ok(value) if value.allow_read => value.clone(),
        Ok(_) => return json_error(StatusCode::FORBIDDEN, "This client may not read accounts"),
        Err(error) => return json_error(StatusCode::UNAUTHORIZED, &error),
    };
    if !session.payload.local_api.export_enabled {
        let application = application_from_client(&client);
        append_server_audit(
            &state.app,
            session,
            ACCOUNT_ROUTE,
            "account_request",
            "blocked",
            &application,
            Some(&client),
            None,
            client.group_id.clone(),
            0,
            None,
            &connection.remote_address.to_string(),
            Some(envelope.request_id.clone()),
            "Account reads are paused",
        );
        return json_error(StatusCode::SERVICE_UNAVAILABLE, "Account reads are paused");
    }
    let body = match decrypt::<AccountRequestBody>(&runtime, &identity, &envelope, ACCOUNT_ROUTE) {
        Ok(value) => value,
        Err(error) => return json_error(StatusCode::BAD_REQUEST, &error),
    };
    if !application_matches(&client, &body.application) {
        append_server_audit(
            &state.app,
            session,
            ACCOUNT_ROUTE,
            "account_request",
            "blocked",
            &body.application,
            Some(&client),
            None,
            client.group_id.clone(),
            0,
            None,
            &connection.remote_address.to_string(),
            Some(envelope.request_id.clone()),
            "The software identity did not match its pairing",
        );
        return json_error(
            StatusCode::FORBIDDEN,
            "The software identity does not match its pairing",
        );
    }
    let caller = windows_identity::inspect(connection.remote_address, &body.application);
    if !windows_identity::verified_caller_matches(&client, &caller) {
        append_server_audit(
            &state.app,
            session,
            ACCOUNT_ROUTE,
            "account_request",
            "blocked",
            &body.application,
            Some(&client),
            None,
            client.group_id.clone(),
            0,
            caller.source_pid,
            &connection.remote_address.to_string(),
            Some(envelope.request_id.clone()),
            "The verified executable identity changed since pairing",
        );
        return json_error(
            StatusCode::FORBIDDEN,
            "The verified executable identity changed since pairing",
        );
    }
    if body.purpose.trim().is_empty() || body.purpose.len() > 2_000 {
        append_server_audit(
            &state.app,
            session,
            ACCOUNT_ROUTE,
            "account_request",
            "failed",
            &body.application,
            Some(&client),
            None,
            client.group_id.clone(),
            0,
            caller.source_pid,
            &connection.remote_address.to_string(),
            Some(envelope.request_id.clone()),
            "A valid purpose is required",
        );
        return json_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "A valid purpose is required",
        );
    }
    if envelope.key_id.as_deref() != Some(body.key_id.as_str()) {
        append_server_audit(
            &state.app,
            session,
            ACCOUNT_ROUTE,
            "account_request",
            "blocked",
            &body.application,
            Some(&client),
            None,
            client.group_id.clone(),
            0,
            caller.source_pid,
            &connection.remote_address.to_string(),
            Some(envelope.request_id.clone()),
            "The outer keyId did not match the encrypted body",
        );
        return json_error(
            StatusCode::UNAUTHORIZED,
            "The outer keyId does not match the encrypted body",
        );
    }
    let key = match active_key(
        &session.payload.local_api,
        &body.key_id,
        &body.key_secret,
        &client.id,
    ) {
        Ok(value) => value.clone(),
        Err(error) => {
            append_server_audit(
                &state.app,
                session,
                ACCOUNT_ROUTE,
                "account_request",
                "blocked",
                &body.application,
                Some(&client),
                None,
                client.group_id.clone(),
                0,
                caller.source_pid,
                &connection.remote_address.to_string(),
                Some(envelope.request_id.clone()),
                &error,
            );
            return json_error(StatusCode::UNAUTHORIZED, &error);
        }
    };
    if !account_scope_valid(&client, &key, &session.payload.groups) {
        append_server_audit(
            &state.app,
            session,
            ACCOUNT_ROUTE,
            "account_request",
            "blocked",
            &body.application,
            Some(&client),
            Some(key.name.clone()),
            Some(key.group_id.clone()),
            0,
            caller.source_pid,
            &connection.remote_address.to_string(),
            Some(envelope.request_id.clone()),
            "The client and API key group scopes did not match",
        );
        return json_error(
            StatusCode::FORBIDDEN,
            "The client and API key group scopes do not match",
        );
    }
    let Some(group) = session
        .payload
        .groups
        .iter()
        .find(|group| group.id == key.group_id)
    else {
        return json_error(
            StatusCode::FORBIDDEN,
            "The authorized group no longer exists",
        );
    };
    let accounts = session
        .payload
        .accounts
        .iter()
        .filter(|account| !account.group_id.is_empty() && account.group_id == key.group_id)
        .map(|account| ExportAccountPreview {
            name: account.name.clone(),
            email: account.email.clone(),
            has_password: !account.password.is_empty(),
            has_totp: !account.totp_secret.is_empty(),
        })
        .collect::<Vec<_>>();
    let preview = PendingApiExport {
        id: envelope.request_id.clone(),
        client_id: client.id.clone(),
        application: body.application.clone(),
        purpose: body.purpose.clone(),
        api_key_name: key.name.clone(),
        api_key_id: key.id.clone(),
        group_id: group.id.clone(),
        group_name: group.name.clone(),
        accounts,
        requested_at: Utc::now().to_rfc3339(),
        remote_address: connection.remote_address.to_string(),
        source_pid: caller.source_pid,
        executable_path: caller.executable_path.clone(),
        executable_sha256: caller.executable_sha256.clone(),
        authenticode_publisher: caller.authenticode_publisher.clone(),
        signature_status: caller.signature_status.clone(),
    };
    audit::append(
        &mut session.payload.local_api,
        AuditContext {
            route: ACCOUNT_ROUTE,
            action: "account_request",
            outcome: "pending",
            application: &preview.application,
            client: Some(&client),
            api_key_name: Some(key.name.clone()),
            group_id: Some(key.group_id.clone()),
            account_count: preview.accounts.len(),
            source_pid: preview.source_pid,
            remote_address: &preview.remote_address,
            request_id: Some(preview.id.clone()),
            detail: "Encrypted account request is waiting for one-time approval".to_string(),
        },
    );
    if let Err(error) = persist_session_payload(&state.app, session) {
        return json_error(StatusCode::INTERNAL_SERVER_ERROR, &error);
    }
    drop(security);

    let mut inner = match runtime.inner.lock() {
        Ok(value) => value,
        Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "Runtime unavailable"),
    };
    if pending_count(&inner) >= 25 {
        return json_error(StatusCode::TOO_MANY_REQUESTS, "Too many pending requests");
    }
    inner.exports.insert(
        preview.id.clone(),
        PendingExportRecord {
            preview: preview.clone(),
        },
    );
    inner.receipts.insert(
        preview.id.clone(),
        pending_receipt(
            &preview.id,
            &preview.client_id,
            ReceiptKind::Account,
            Some(preview.api_key_id.clone()),
            Some(preview.group_id.clone()),
        ),
    );
    drop(inner);
    focus_main_window(&state.app);
    let _ = state.app.emit("local-api-export-request", &preview);
    notify_state_changed(&state.app);
    let client_public = match decode_x25519_public(&client.encryption_public_key) {
        Ok(value) => value,
        Err(error) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    encrypted_accepted(
        &identity,
        &preview.client_id,
        &preview.id,
        client_public,
        serde_json::json!({
            "requestId": preview.id,
            "status": "pending",
            "statusEndpoint": "https://127.0.0.1:46329/v2/request-status"
        }),
    )
}

async fn pairing_status(
    State(state): State<ApiState>,
    Json(envelope): Json<EncryptedEnvelope>,
) -> Response {
    let runtime = state.app.state::<LocalApiRuntime>();
    let identity = match runtime.current_identity() {
        Ok(value) => value,
        Err(error) => return json_error(StatusCode::SERVICE_UNAVAILABLE, &error),
    };
    let body =
        match decrypt::<StatusRequestBody>(&runtime, &identity, &envelope, PAIRING_STATUS_ROUTE) {
            Ok(value) => value,
            Err(error) => return json_error(StatusCode::BAD_REQUEST, &error),
        };
    let mut inner = match runtime.inner.lock() {
        Ok(value) => value,
        Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "Runtime unavailable"),
    };
    let response_public_key = inner
        .pairings
        .get(&body.request_id)
        .map(|record| record.encryption_public_key);
    let Some(receipt) = inner.receipts.get_mut(&body.request_id) else {
        return json_error(StatusCode::NOT_FOUND, "Unknown pairing request");
    };
    if receipt.kind != ReceiptKind::Pairing || receipt.client_id != envelope.client_id {
        return json_error(
            StatusCode::FORBIDDEN,
            "The pairing receipt does not belong to this client",
        );
    }
    expire_pending(receipt);
    if receipt.encrypted_response.is_some() || receipt.delivered {
        return match receipt.take_encrypted_response_once() {
            Ok(response) => (StatusCode::OK, Json(response)).into_response(),
            Err(_) => json_error(StatusCode::GONE, "The pairing result was already delivered"),
        };
    }
    let Some(response_public_key) = response_public_key else {
        return json_error(StatusCode::GONE, "The pairing request expired");
    };
    let response = match encrypt_response(
        &serde_json::json!({
            "requestId": receipt.request_id,
            "status": receipt.status,
            "updatedAt": receipt.updated_at,
            "detail": receipt.detail
        }),
        identity.instance_id(),
        &receipt.client_id,
        &receipt.request_id,
        "/v2/pairing-responses",
        response_public_key,
    ) {
        Ok(value) => value,
        Err(error) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    (StatusCode::OK, Json(response)).into_response()
}

async fn request_status(
    State(state): State<ApiState>,
    Extension(connection): Extension<ConnectionInfo>,
    Json(envelope): Json<EncryptedEnvelope>,
) -> Response {
    let runtime = state.app.state::<LocalApiRuntime>();
    let identity = match runtime.current_identity() {
        Ok(value) => value,
        Err(error) => return json_error(StatusCode::SERVICE_UNAVAILABLE, &error),
    };
    let security_state = state.app.state::<AppSecurityState>();
    let security = match state_lock(&security_state) {
        Ok(value) => value,
        Err(error) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    let Some(session) = security.unlocked.as_ref() else {
        return json_error(StatusCode::LOCKED, "Github Auth is locked");
    };
    let client = match active_client(
        &session.payload.local_api,
        &envelope.client_id,
        connection.certificate_fingerprint.as_deref(),
    ) {
        Ok(value) => value.clone(),
        Err(error) => return json_error(StatusCode::UNAUTHORIZED, &error),
    };
    let caller = windows_identity::inspect_paired(connection.remote_address, &client);
    if !windows_identity::verified_caller_matches(&client, &caller) {
        return json_error(
            StatusCode::FORBIDDEN,
            "The verified executable identity changed since pairing",
        );
    }
    let body = match decrypt::<StatusRequestBody>(&runtime, &identity, &envelope, STATUS_ROUTE) {
        Ok(value) => value,
        Err(error) => return json_error(StatusCode::BAD_REQUEST, &error),
    };
    let client_public = match decode_x25519_public(&client.encryption_public_key) {
        Ok(value) => value,
        Err(error) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };

    let mut inner = match runtime.inner.lock() {
        Ok(value) => value,
        Err(_) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, "Runtime unavailable"),
    };
    let Some(receipt) = inner.receipts.get_mut(&body.request_id) else {
        return json_error(StatusCode::NOT_FOUND, "Unknown request ID");
    };
    if receipt.client_id != client.id || receipt.kind == ReceiptKind::Pairing {
        return json_error(
            StatusCode::FORBIDDEN,
            "The receipt does not belong to this client",
        );
    }
    expire_pending(receipt);

    if receipt.kind == ReceiptKind::Account {
        if !session.payload.local_api.export_enabled {
            return json_error(StatusCode::FORBIDDEN, "Account reads were paused");
        }
        let key_id = body.key_id.as_deref().unwrap_or_default();
        let key_secret = body.key_secret.as_deref().unwrap_or_default();
        let key = match active_key(&session.payload.local_api, key_id, key_secret, &client.id) {
            Ok(value) => value,
            Err(error) => return json_error(StatusCode::UNAUTHORIZED, &error),
        };
        if !account_scope_valid(&client, key, &session.payload.groups) {
            return json_error(StatusCode::FORBIDDEN, "The read scope is no longer valid");
        }
        if receipt.api_key_id.as_deref() != Some(key.id.as_str())
            || receipt.group_id.as_deref() != Some(key.group_id.as_str())
        {
            return json_error(
                StatusCode::FORBIDDEN,
                "The API key scope does not match this request",
            );
        }
        if receipt.status == "approved" {
            let response = match receipt.take_encrypted_response_once() {
                Ok(value) => value,
                Err(_) => {
                    return json_error(
                        StatusCode::GONE,
                        "The approved response was already delivered",
                    )
                }
            };
            receipt.status = "delivered".to_string();
            receipt.updated_at = Utc::now().to_rfc3339();
            return (StatusCode::OK, Json(response)).into_response();
        }
    }
    let response = match encrypt_response(
        &serde_json::json!({
            "requestId": receipt.request_id,
            "status": receipt.status,
            "updatedAt": receipt.updated_at,
            "detail": receipt.detail
        }),
        identity.instance_id(),
        &client.id,
        &receipt.request_id,
        "/v2/status-responses",
        client_public,
    ) {
        Ok(value) => value,
        Err(error) => return json_error(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    (StatusCode::OK, Json(response)).into_response()
}

fn decrypt<T: DeserializeOwned>(
    runtime: &LocalApiRuntime,
    identity: &super::identity::LocalIdentity,
    envelope: &EncryptedEnvelope,
    route: &str,
) -> Result<T, String> {
    let value = decrypt_request(
        envelope,
        identity.instance_id(),
        route,
        identity.encryption_secret()?,
    )?;
    runtime
        .replay
        .lock()
        .map_err(|_| "The replay cache is unavailable".to_string())?
        .as_mut()
        .ok_or_else(|| "The replay cache is unavailable".to_string())?
        .check_and_record(envelope)?;
    Ok(value)
}

fn application_from_client(client: &super::models::PairedClient) -> ClientApplication {
    ClientApplication {
        name: client.application_name.clone(),
        developer: client.developer.clone(),
        icon: client.icon.clone(),
        description: client.description.clone(),
        executable_path: client.executable_path.clone(),
    }
}

#[allow(clippy::too_many_arguments)]
fn append_server_audit(
    app: &AppHandle,
    session: &mut crate::UnlockedSession,
    route: &str,
    action: &str,
    outcome: &str,
    application: &ClientApplication,
    client: Option<&super::models::PairedClient>,
    api_key_name: Option<String>,
    group_id: Option<String>,
    account_count: usize,
    source_pid: Option<u32>,
    remote_address: &str,
    request_id: Option<String>,
    detail: &str,
) {
    audit::append(
        &mut session.payload.local_api,
        AuditContext {
            route,
            action,
            outcome,
            application,
            client,
            api_key_name,
            group_id,
            account_count,
            source_pid,
            remote_address,
            request_id,
            detail: detail.to_string(),
        },
    );
    let _ = persist_session_payload(app, session);
    notify_state_changed(app);
}

fn validate_import(body: &ImportRequestBody) -> Result<(), String> {
    validate_application(&body.application)?;
    if body.purpose.trim().is_empty() || body.purpose.len() > 2_000 {
        return Err("A valid purpose is required".to_string());
    }
    if body.accounts.is_empty() || body.accounts.len() > 100 {
        return Err("accounts must contain between 1 and 100 items".to_string());
    }
    if body.accounts.iter().any(|account| {
        account.name.trim().is_empty()
            || account.name.len() > 256
            || account.email.trim().is_empty()
            || account.email.len() > 512
            || account.password.is_empty()
            || account.password.len() > 16_384
            || account.emails.len() > 31
            || account
                .emails
                .iter()
                .any(|email| email.trim().is_empty() || email.len() > 512)
            || account.totp_secret.len() > 4_096
            || account.note.len() > 4_096
            || account
                .avatar_url
                .as_deref()
                .is_some_and(|url| url.len() > 2_048 || !url.starts_with("https://"))
    }) {
        return Err("Every account requires a valid name, email and password".to_string());
    }
    Ok(())
}

fn pending_count(inner: &super::RuntimeInner) -> usize {
    inner.pairings.len() + inner.imports.len() + inner.exports.len()
}

fn pending_receipt(
    request_id: &str,
    client_id: &str,
    kind: ReceiptKind,
    api_key_id: Option<String>,
    group_id: Option<String>,
) -> RequestReceipt {
    RequestReceipt {
        request_id: request_id.to_string(),
        client_id: client_id.to_string(),
        kind,
        status: "pending".to_string(),
        updated_at: Utc::now().to_rfc3339(),
        detail: "Waiting for approval in Github Auth".to_string(),
        encrypted_response: None,
        delivered: false,
        api_key_id,
        group_id,
    }
}

fn expire_pending(receipt: &mut RequestReceipt) {
    if receipt.status != "pending" {
        return;
    }
    let expired = chrono::DateTime::parse_from_rfc3339(&receipt.updated_at)
        .map(|time| {
            time.with_timezone(&Utc) < Utc::now() - ChronoDuration::seconds(PENDING_TTL_SECONDS)
        })
        .unwrap_or(true);
    if expired {
        receipt.status = "expired".to_string();
        receipt.updated_at = Utc::now().to_rfc3339();
        receipt.detail = "The approval request expired after 10 minutes".to_string();
    }
}

fn encrypted_accepted<T: Serialize>(
    identity: &super::identity::LocalIdentity,
    client_id: &str,
    request_id: &str,
    client_public: [u8; 32],
    payload: T,
) -> Response {
    match encrypt_response(
        &payload,
        identity.instance_id(),
        client_id,
        request_id,
        "/v2/status-responses",
        client_public,
    ) {
        Ok(response) => (StatusCode::ACCEPTED, Json(response)).into_response(),
        Err(error) => json_error(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

fn json_error(status: StatusCode, message: &str) -> Response {
    (status, Json(serde_json::json!({ "error": message }))).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_sensitive_routes_require_upgrade() {
        assert_eq!(route_policy("POST", "/v1/import-requests"), 426);
        assert_eq!(route_policy("POST", "/v1/accounts/query"), 426);
        assert_eq!(route_policy("GET", "/v1/requests/id"), 426);
        assert_eq!(route_policy("GET", "/health"), 200);
    }
}
