use std::{
    collections::HashMap,
    io::Read,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use constant_time_eq::constant_time_eq;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};
use uuid::Uuid;
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::vault::{VaultAccount, VaultEmail, VaultGroup, VaultPayload};
use crate::{persist_session_payload, state_lock, verify_action_secret, AppSecurityState};

pub const LOCAL_API_PORT: u16 = 46_329;
const MAX_REQUEST_BYTES: u64 = 1024 * 1024;
const MAX_PENDING_REQUESTS: usize = 25;
const MAX_RECEIPTS: usize = 100;
const MAX_LOGS: usize = 500;
const PENDING_TTL_SECONDS: i64 = 10 * 60;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LocalApiConfig {
    #[serde(default)]
    pub export_enabled: bool,
    #[serde(default)]
    pub api_keys: Vec<LocalApiKey>,
    #[serde(default)]
    pub logs: Vec<LocalApiLog>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LocalApiKey {
    pub id: String,
    pub name: String,
    pub key_hash: String,
    pub group_id: String,
    pub enabled: bool,
    pub created_at: String,
    pub last_used_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LocalApiLog {
    pub id: String,
    pub occurred_at: String,
    pub method: String,
    pub endpoint: String,
    pub action: String,
    pub outcome: String,
    pub app_name: String,
    pub developer: String,
    pub api_key_name: Option<String>,
    pub group_id: Option<String>,
    pub account_count: usize,
    pub remote_address: String,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ClientApplication {
    pub name: String,
    pub developer: String,
    pub icon: String,
    pub description: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct IncomingAccount {
    pub name: String,
    pub email: String,
    pub password: String,
    #[serde(default)]
    pub emails: Vec<String>,
    #[serde(default)]
    pub totp_secret: String,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub github_created_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct PendingApiImport {
    pub id: String,
    pub application: ClientApplication,
    pub accounts: Vec<IncomingAccount>,
    pub requested_at: String,
    pub remote_address: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ImportRequestBody {
    application: ClientApplication,
    accounts: Vec<IncomingAccount>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ExportRequestBody {
    application: ClientApplication,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ApproveImportInput {
    request_id: String,
    group_id: Option<String>,
    new_group_name: Option<String>,
    auth_kind: String,
    credential: String,
}

#[derive(Clone, Debug)]
struct RequestReceipt {
    request_id: String,
    status: String,
    updated_at: String,
    detail: String,
    expected_key_hash: Option<String>,
    export_group_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct ExportAccountPreview {
    pub name: String,
    pub email: String,
    pub has_password: bool,
    pub has_totp: bool,
}

#[derive(Clone, Debug, Serialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct PendingApiExport {
    pub id: String,
    pub application: ClientApplication,
    pub api_key_name: String,
    pub api_key_id: String,
    pub group_id: String,
    pub group_name: String,
    pub accounts: Vec<ExportAccountPreview>,
    pub requested_at: String,
    pub remote_address: String,
}

#[derive(Default)]
struct RuntimeInner {
    pending: HashMap<String, PendingApiImport>,
    pending_exports: HashMap<String, PendingApiExport>,
    receipts: HashMap<String, RequestReceipt>,
}

#[derive(Default)]
pub struct LocalApiRuntime {
    listening: AtomicBool,
    inner: Mutex<RuntimeInner>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalApiRuntimeStatus {
    pub listening: bool,
    pub base_url: String,
    pub import_endpoint: String,
    pub export_endpoint: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedApiKey {
    pub api_key: String,
    pub config: LocalApiConfig,
}

pub fn validate_config(config: &LocalApiConfig, _groups: &[VaultGroup]) -> Result<(), String> {
    if config.api_keys.len() > 1_000 || config.logs.len() > MAX_LOGS {
        return Err("Local API configuration contains too many records".to_string());
    }
    if config.api_keys.iter().any(|key| {
        key.id.is_empty()
            || key.id.len() > 128
            || key.name.trim().is_empty()
            || key.name.len() > 128
            || key.key_hash.len() != 64
            || key.group_id.is_empty()
            || key.group_id.len() > 128
    }) {
        return Err("Local API key configuration is invalid".to_string());
    }
    if config.logs.iter().any(|log| {
        log.id.is_empty()
            || log.app_name.len() > 128
            || log.developer.len() > 256
            || log.detail.len() > 2_048
            || log.endpoint.len() > 128
            || log.remote_address.len() > 128
    }) {
        return Err("Local API log data is invalid".to_string());
    }
    Ok(())
}

fn validate_application(application: &ClientApplication) -> Result<(), String> {
    let icon = application.icon.trim();
    let supported_inline_icon = [
        "data:image/png;base64,",
        "data:image/jpeg;base64,",
        "data:image/webp;base64,",
        "data:image/gif;base64,",
        "data:image/x-icon;base64,",
    ]
    .iter()
    .any(|prefix| icon.starts_with(prefix));
    let valid_icon = (icon.starts_with("https://") && icon.len() <= 2_048)
        || (supported_inline_icon && icon.len() <= 262_144);
    if application.name.trim().is_empty()
        || application.name.len() > 128
        || application.developer.trim().is_empty()
        || application.developer.len() > 256
        || application.description.trim().is_empty()
        || application.description.len() > 2_000
        || !valid_icon
    {
        return Err(
            "application.name, developer, icon and description are required and must be valid"
                .to_string(),
        );
    }
    Ok(())
}

fn validate_import(body: &ImportRequestBody) -> Result<(), String> {
    validate_application(&body.application)?;
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
            || account
                .github_created_at
                .as_deref()
                .is_some_and(|value| value.len() > 64)
    }) {
        return Err("Every account requires a valid name, email and password".to_string());
    }
    Ok(())
}

fn key_hash(value: &str) -> String {
    data_encoding::HEXLOWER.encode(&Sha256::digest(value.as_bytes()))
}

fn json_header() -> Header {
    Header::from_bytes("Content-Type", "application/json; charset=utf-8")
        .expect("static response header is valid")
}

fn json_response(status: u16, value: serde_json::Value) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_data(
        serde_json::to_vec(&value)
            .unwrap_or_else(|_| b"{\"error\":\"response serialization failed\"}".to_vec()),
    )
    .with_status_code(StatusCode(status))
    .with_header(json_header())
}

fn read_json_body<T: for<'de> Deserialize<'de>>(request: &mut Request) -> Result<T, String> {
    let mut bytes = Vec::new();
    request
        .as_reader()
        .take(MAX_REQUEST_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Unable to read request body".to_string())?;
    if bytes.len() as u64 > MAX_REQUEST_BYTES {
        return Err("Request body is too large".to_string());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Request body must be valid JSON".to_string())
}

fn remote_address(request: &Request) -> String {
    request
        .remote_addr()
        .map(ToString::to_string)
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

fn append_log(config: &mut LocalApiConfig, log: LocalApiLog) {
    config.logs.insert(0, log);
    config.logs.truncate(MAX_LOGS);
}

fn prune_receipts(inner: &mut RuntimeInner) {
    while inner.receipts.len() > MAX_RECEIPTS {
        let oldest = inner
            .receipts
            .iter()
            .min_by(|left, right| left.1.updated_at.cmp(&right.1.updated_at))
            .map(|(id, _)| id.clone());
        if let Some(id) = oldest {
            inner.receipts.remove(&id);
        } else {
            break;
        }
    }
}

fn is_expired(requested_at: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(requested_at)
        .map(|created| {
            Utc::now()
                .signed_duration_since(created.with_timezone(&Utc))
                .num_seconds()
                > PENDING_TTL_SECONDS
        })
        .unwrap_or(true)
}

fn prune_expired_pending(inner: &mut RuntimeInner) -> bool {
    let mut expired_ids = inner
        .pending
        .iter()
        .filter(|(_, request)| is_expired(&request.requested_at))
        .map(|(id, _)| id.clone())
        .collect::<Vec<_>>();
    expired_ids.extend(
        inner
            .pending_exports
            .iter()
            .filter(|(_, request)| is_expired(&request.requested_at))
            .map(|(id, _)| id.clone()),
    );
    if expired_ids.is_empty() {
        return false;
    }
    for id in expired_ids {
        inner.pending.remove(&id);
        inner.pending_exports.remove(&id);
        if let Some(receipt) = inner.receipts.get_mut(&id) {
            receipt.status = "expired".to_string();
            receipt.updated_at = Utc::now().to_rfc3339();
            receipt.detail = "The approval request expired after 10 minutes".to_string();
        }
    }
    true
}

#[allow(clippy::too_many_arguments)]
fn make_log(
    method: &str,
    endpoint: &str,
    action: &str,
    outcome: &str,
    application: &ClientApplication,
    api_key_name: Option<String>,
    group_id: Option<String>,
    account_count: usize,
    remote_address: &str,
    detail: impl Into<String>,
) -> LocalApiLog {
    LocalApiLog {
        id: Uuid::new_v4().to_string(),
        occurred_at: Utc::now().to_rfc3339(),
        method: method.to_string(),
        endpoint: endpoint.to_string(),
        action: action.to_string(),
        outcome: outcome.to_string(),
        app_name: application.name.trim().to_string(),
        developer: application.developer.trim().to_string(),
        api_key_name,
        group_id,
        account_count,
        remote_address: remote_address.to_string(),
        detail: detail.into(),
    }
}

fn notify_state_changed(app: &AppHandle) {
    let _ = app.emit("local-api-state-changed", ());
}

fn handle_import(app: &AppHandle, mut request: Request) {
    let remote = remote_address(&request);
    let body = match read_json_body::<ImportRequestBody>(&mut request) {
        Ok(body) => body,
        Err(error) => {
            let _ = request.respond(json_response(400, serde_json::json!({ "error": error })));
            return;
        }
    };
    if let Err(error) = validate_import(&body) {
        let _ = request.respond(json_response(422, serde_json::json!({ "error": error })));
        return;
    }

    let runtime = app.state::<LocalApiRuntime>();
    let runtime_inner = match runtime.inner.lock() {
        Ok(value) => value,
        Err(_) => {
            let _ = request.respond(json_response(
                500,
                serde_json::json!({ "error": "Local API runtime is unavailable" }),
            ));
            return;
        }
    };
    if runtime_inner.pending.len() + runtime_inner.pending_exports.len() >= MAX_PENDING_REQUESTS {
        let _ = request.respond(json_response(
            429,
            serde_json::json!({ "error": "Too many pending import requests" }),
        ));
        return;
    }
    drop(runtime_inner);

    let security_state = app.state::<AppSecurityState>();
    let mut security = match state_lock(&security_state) {
        Ok(value) => value,
        Err(error) => {
            let _ = request.respond(json_response(500, serde_json::json!({ "error": error })));
            return;
        }
    };
    let Some(session) = security.unlocked.as_mut() else {
        let _ = request.respond(json_response(
            423,
            serde_json::json!({ "error": "Github Auth is locked" }),
        ));
        return;
    };

    let pending = PendingApiImport {
        id: Uuid::new_v4().to_string(),
        application: body.application,
        accounts: body.accounts,
        requested_at: Utc::now().to_rfc3339(),
        remote_address: remote,
    };
    append_log(
        &mut session.payload.local_api,
        make_log(
            "POST",
            "/v1/import-requests",
            "import_request",
            "pending",
            &pending.application,
            None,
            None,
            pending.accounts.len(),
            &pending.remote_address,
            format!(
                "Waiting for approval for {} account(s)",
                pending.accounts.len()
            ),
        ),
    );
    if let Err(error) = persist_session_payload(app, session) {
        let _ = request.respond(json_response(500, serde_json::json!({ "error": error })));
        return;
    }

    let receipt = RequestReceipt {
        request_id: pending.id.clone(),
        status: "pending".to_string(),
        updated_at: Utc::now().to_rfc3339(),
        detail: "Waiting for approval in Github Auth".to_string(),
        expected_key_hash: None,
        export_group_id: None,
    };
    let mut runtime_inner = match runtime.inner.lock() {
        Ok(value) => value,
        Err(_) => {
            let _ = request.respond(json_response(
                500,
                serde_json::json!({ "error": "Local API runtime is unavailable" }),
            ));
            return;
        }
    };
    runtime_inner
        .receipts
        .insert(pending.id.clone(), receipt.clone());
    runtime_inner
        .pending
        .insert(pending.id.clone(), pending.clone());
    prune_receipts(&mut runtime_inner);
    drop(security);
    drop(runtime_inner);

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit("local-api-import-request", &pending);
    notify_state_changed(app);
    let _ = request.respond(json_response(
        202,
        serde_json::json!({
            "requestId": pending.id,
            "status": "pending",
            "statusUrl": format!("http://127.0.0.1:{LOCAL_API_PORT}/v1/requests/{}", receipt.request_id)
        }),
    ));
}

fn bearer_token(request: &Request) -> Option<String> {
    request.headers().iter().find_map(|header| {
        if header.field.equiv("Authorization") {
            header
                .value
                .as_str()
                .strip_prefix("Bearer ")
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        } else {
            None
        }
    })
}

fn handle_export(app: &AppHandle, mut request: Request) {
    let remote = remote_address(&request);
    let token = bearer_token(&request);
    let body = match read_json_body::<ExportRequestBody>(&mut request) {
        Ok(body) => body,
        Err(error) => {
            let _ = request.respond(json_response(400, serde_json::json!({ "error": error })));
            return;
        }
    };
    if let Err(error) = validate_application(&body.application) {
        let _ = request.respond(json_response(422, serde_json::json!({ "error": error })));
        return;
    }

    let runtime = app.state::<LocalApiRuntime>();
    let runtime_inner = match runtime.inner.lock() {
        Ok(value) => value,
        Err(_) => {
            let _ = request.respond(json_response(
                500,
                serde_json::json!({ "error": "Local API runtime is unavailable" }),
            ));
            return;
        }
    };
    if runtime_inner.pending.len() + runtime_inner.pending_exports.len() >= MAX_PENDING_REQUESTS {
        let _ = request.respond(json_response(
            429,
            serde_json::json!({ "error": "Too many pending requests" }),
        ));
        return;
    }
    drop(runtime_inner);

    let security_state = app.state::<AppSecurityState>();
    let mut security = match state_lock(&security_state) {
        Ok(value) => value,
        Err(error) => {
            let _ = request.respond(json_response(500, serde_json::json!({ "error": error })));
            return;
        }
    };
    let Some(session) = security.unlocked.as_mut() else {
        let _ = request.respond(json_response(
            423,
            serde_json::json!({ "error": "Github Auth is locked" }),
        ));
        return;
    };

    if !session.payload.local_api.export_enabled {
        append_log(
            &mut session.payload.local_api,
            make_log(
                "POST",
                "/v1/accounts/query",
                "account_export",
                "blocked",
                &body.application,
                None,
                None,
                0,
                &remote,
                "Account export is paused",
            ),
        );
        let _ = persist_session_payload(app, session);
        notify_state_changed(app);
        let _ = request.respond(json_response(
            503,
            serde_json::json!({ "error": "Account export is paused" }),
        ));
        return;
    }

    let supplied_hash = token.as_deref().map(key_hash);
    let key_index = supplied_hash.as_deref().and_then(|candidate| {
        session.payload.local_api.api_keys.iter().position(|key| {
            key.enabled
                && key.key_hash.len() == candidate.len()
                && constant_time_eq(key.key_hash.as_bytes(), candidate.as_bytes())
        })
    });
    let Some(key_index) = key_index else {
        append_log(
            &mut session.payload.local_api,
            make_log(
                "POST",
                "/v1/accounts/query",
                "account_export",
                "denied",
                &body.application,
                None,
                None,
                0,
                &remote,
                "Missing, invalid or disabled API key",
            ),
        );
        let _ = persist_session_payload(app, session);
        notify_state_changed(app);
        let _ = request.respond(json_response(
            401,
            serde_json::json!({ "error": "Invalid API key" }),
        ));
        return;
    };

    let key = session.payload.local_api.api_keys[key_index].clone();
    let group = session
        .payload
        .groups
        .iter()
        .find(|group| group.id == key.group_id)
        .cloned();
    let Some(group) = group else {
        append_log(
            &mut session.payload.local_api,
            make_log(
                "POST",
                "/v1/accounts/query",
                "account_export",
                "denied",
                &body.application,
                Some(key.name.clone()),
                Some(key.group_id.clone()),
                0,
                &remote,
                "The API key group no longer exists",
            ),
        );
        let _ = persist_session_payload(app, session);
        notify_state_changed(app);
        let _ = request.respond(json_response(
            403,
            serde_json::json!({ "error": "The permitted group no longer exists" }),
        ));
        return;
    };

    let accounts = session
        .payload
        .accounts
        .iter()
        .filter(|account| account.group_id == group.id)
        .map(|account| ExportAccountPreview {
            name: account.name.clone(),
            email: account.email.clone(),
            has_password: !account.password.is_empty(),
            has_totp: !account.totp_secret.is_empty(),
        })
        .collect::<Vec<_>>();
    let pending = PendingApiExport {
        id: Uuid::new_v4().to_string(),
        application: body.application,
        api_key_name: key.name.clone(),
        api_key_id: key.id.clone(),
        group_id: group.id.clone(),
        group_name: group.name.clone(),
        accounts,
        requested_at: Utc::now().to_rfc3339(),
        remote_address: remote,
    };
    append_log(
        &mut session.payload.local_api,
        make_log(
            "POST",
            "/v1/accounts/query",
            "account_export",
            "pending",
            &pending.application,
            Some(key.name.clone()),
            Some(group.id.clone()),
            pending.accounts.len(),
            &pending.remote_address,
            format!("Waiting for approval to read group {}", group.name),
        ),
    );
    if let Err(error) = persist_session_payload(app, session) {
        let _ = request.respond(json_response(500, serde_json::json!({ "error": error })));
        return;
    }
    let mut inner = match runtime.inner.lock() {
        Ok(value) => value,
        Err(_) => {
            let _ = request.respond(json_response(
                500,
                serde_json::json!({ "error": "Local API runtime is unavailable" }),
            ));
            return;
        }
    };
    let receipt = RequestReceipt {
        request_id: pending.id.clone(),
        status: "pending".to_string(),
        updated_at: Utc::now().to_rfc3339(),
        detail: "Waiting for approval in Github Auth".to_string(),
        expected_key_hash: supplied_hash,
        export_group_id: Some(group.id.clone()),
    };
    inner.receipts.insert(pending.id.clone(), receipt.clone());
    inner
        .pending_exports
        .insert(pending.id.clone(), pending.clone());
    prune_receipts(&mut inner);
    drop(inner);
    drop(security);

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit("local-api-export-request", &pending);
    notify_state_changed(app);
    let _ = request.respond(json_response(
        202,
        serde_json::json!({
            "requestId": pending.id,
            "status": "pending",
            "statusUrl": format!("http://127.0.0.1:{LOCAL_API_PORT}/v1/requests/{}", receipt.request_id)
        }),
    ));
}

fn handle_status(app: &AppHandle, request: Request, request_id: &str) {
    let runtime = app.state::<LocalApiRuntime>();
    let receipt = runtime
        .inner
        .lock()
        .ok()
        .and_then(|inner| inner.receipts.get(request_id).cloned());
    let response = match receipt {
        None => json_response(404, serde_json::json!({ "error": "Unknown request ID" })),
        Some(receipt) => {
            if let Some(expected_hash) = receipt.expected_key_hash.as_deref() {
                let Some(token) = bearer_token(&request) else {
                    let _ = request.respond(json_response(
                        401,
                        serde_json::json!({ "error": "API key required" }),
                    ));
                    return;
                };
                let candidate = key_hash(&token);
                if candidate.len() != expected_hash.len()
                    || !constant_time_eq(candidate.as_bytes(), expected_hash.as_bytes())
                {
                    let _ = request.respond(json_response(
                        401,
                        serde_json::json!({ "error": "Invalid API key" }),
                    ));
                    return;
                }
                if receipt.status == "approved" {
                    let security_state = app.state::<AppSecurityState>();
                    let security = match state_lock(&security_state) {
                        Ok(value) => value,
                        Err(error) => {
                            let _ = request
                                .respond(json_response(500, serde_json::json!({ "error": error })));
                            return;
                        }
                    };
                    let Some(session) = security.unlocked.as_ref() else {
                        let _ = request.respond(json_response(
                            423,
                            serde_json::json!({ "error": "Github Auth is locked" }),
                        ));
                        return;
                    };
                    let key_still_valid = session.payload.local_api.api_keys.iter().any(|key| {
                        key.enabled
                            && key.group_id
                                == receipt.export_group_id.as_deref().unwrap_or_default()
                            && key.key_hash.len() == expected_hash.len()
                            && constant_time_eq(key.key_hash.as_bytes(), expected_hash.as_bytes())
                    });
                    if !session.payload.local_api.export_enabled || !key_still_valid {
                        json_response(403, serde_json::json!({ "error": "Access was revoked" }))
                    } else {
                        let group_id = receipt.export_group_id.as_deref().unwrap_or_default();
                        let group = session
                            .payload
                            .groups
                            .iter()
                            .find(|group| group.id == group_id);
                        let accounts = session
                            .payload
                            .accounts
                            .iter()
                            .filter(|account| account.group_id == group_id)
                            .collect::<Vec<_>>();
                        json_response(
                            200,
                            serde_json::json!({
                                "requestId": receipt.request_id,
                                "status": receipt.status,
                                "updatedAt": receipt.updated_at,
                                "detail": receipt.detail,
                                "group": group,
                                "accounts": accounts
                            }),
                        )
                    }
                } else {
                    json_response(
                        200,
                        serde_json::json!({
                            "requestId": receipt.request_id,
                            "status": receipt.status,
                            "updatedAt": receipt.updated_at,
                            "detail": receipt.detail
                        }),
                    )
                }
            } else {
                json_response(
                    200,
                    serde_json::json!({
                        "requestId": receipt.request_id,
                        "status": receipt.status,
                        "updatedAt": receipt.updated_at,
                        "detail": receipt.detail
                    }),
                )
            }
        }
    };
    let _ = request.respond(response);
}

fn handle_request(app: &AppHandle, request: Request) {
    let method = request.method().clone();
    let path = request
        .url()
        .split('?')
        .next()
        .unwrap_or(request.url())
        .to_string();
    match (method, path.as_str()) {
        (Method::Get, "/health") => {
            let _ = request.respond(json_response(
                200,
                serde_json::json!({
                    "name": "Github Auth Local API",
                    "status": "ready",
                    "importReceiving": true
                }),
            ));
        }
        (Method::Post, "/v1/import-requests") => handle_import(app, request),
        (Method::Post, "/v1/accounts/query") => handle_export(app, request),
        (Method::Get, _) if path.starts_with("/v1/requests/") => {
            let request_id = path.trim_start_matches("/v1/requests/");
            handle_status(app, request, request_id);
        }
        _ => {
            let _ = request.respond(json_response(
                404,
                serde_json::json!({ "error": "Not found" }),
            ));
        }
    }
}

pub fn start_server(app: AppHandle) {
    thread::spawn(move || {
        let runtime = app.state::<LocalApiRuntime>();
        let server = match Server::http(("127.0.0.1", LOCAL_API_PORT)) {
            Ok(server) => server,
            Err(_) => {
                runtime.listening.store(false, Ordering::SeqCst);
                let _ = app.emit(
                    "local-api-runtime-error",
                    "The local API port is unavailable",
                );
                return;
            }
        };
        runtime.listening.store(true, Ordering::SeqCst);
        loop {
            match server.recv_timeout(Duration::from_secs(30)) {
                Ok(Some(request)) => handle_request(&app, request),
                Ok(None) => {
                    let changed = runtime
                        .inner
                        .lock()
                        .map(|mut inner| prune_expired_pending(&mut inner))
                        .unwrap_or(false);
                    if changed {
                        notify_state_changed(&app);
                    }
                }
                Err(_) => break,
            }
        }
        runtime.listening.store(false, Ordering::SeqCst);
    });
}

#[tauri::command]
pub fn get_local_api_runtime_status(runtime: State<'_, LocalApiRuntime>) -> LocalApiRuntimeStatus {
    let base_url = format!("http://127.0.0.1:{LOCAL_API_PORT}");
    LocalApiRuntimeStatus {
        listening: runtime.listening.load(Ordering::SeqCst),
        import_endpoint: format!("{base_url}/v1/import-requests"),
        export_endpoint: format!("{base_url}/v1/accounts/query"),
        base_url,
    }
}

#[tauri::command]
pub fn get_pending_api_imports(
    runtime: State<'_, LocalApiRuntime>,
) -> Result<Vec<PendingApiImport>, String> {
    let inner = runtime
        .inner
        .lock()
        .map_err(|_| "Local API runtime is unavailable".to_string())?;
    let mut pending = inner.pending.values().cloned().collect::<Vec<_>>();
    pending.sort_by(|left, right| left.requested_at.cmp(&right.requested_at));
    Ok(pending)
}

#[tauri::command]
pub fn get_pending_api_exports(
    runtime: State<'_, LocalApiRuntime>,
) -> Result<Vec<PendingApiExport>, String> {
    let inner = runtime
        .inner
        .lock()
        .map_err(|_| "Local API runtime is unavailable".to_string())?;
    let mut pending = inner.pending_exports.values().cloned().collect::<Vec<_>>();
    pending.sort_by(|left, right| left.requested_at.cmp(&right.requested_at));
    Ok(pending)
}

#[tauri::command]
pub fn approve_local_api_import(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    runtime: State<'_, LocalApiRuntime>,
    input: ApproveImportInput,
) -> Result<VaultPayload, String> {
    let ApproveImportInput {
        request_id,
        group_id,
        new_group_name,
        auth_kind,
        credential,
    } = input;
    let pending = runtime
        .inner
        .lock()
        .map_err(|_| "Local API runtime is unavailable".to_string())?
        .pending
        .get(&request_id)
        .cloned()
        .ok_or_else(|| "The import request no longer exists".to_string())?;

    let mut security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_mut()
        .ok_or_else(|| "Unlock the vault before approving an import".to_string())?;
    verify_action_secret(&app, session, &auth_kind, &credential)?;

    let now = Utc::now().to_rfc3339();
    let selected_group = if let Some(requested_name) = new_group_name {
        let name = requested_name.trim();
        if name.is_empty() || name.len() > 256 {
            return Err("Enter a valid group name".to_string());
        }
        let group = VaultGroup {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            color: "#A855F7".to_string(),
            created_at: now.clone(),
        };
        let id = group.id.clone();
        session.payload.groups.push(group);
        id
    } else if let Some(id) = group_id.filter(|id| !id.is_empty()) {
        if !session.payload.groups.iter().any(|group| group.id == id) {
            return Err("The selected group no longer exists".to_string());
        }
        id
    } else {
        String::new()
    };

    for incoming in &pending.accounts {
        let mut values = vec![incoming.email.trim().to_string()];
        for value in &incoming.emails {
            let value = value.trim().to_string();
            if !values
                .iter()
                .any(|existing| existing.eq_ignore_ascii_case(&value))
            {
                values.push(value);
            }
        }
        let emails = values
            .into_iter()
            .enumerate()
            .map(|(index, value)| VaultEmail {
                value,
                is_primary: index == 0,
                show_on_home: index < 2,
            })
            .collect::<Vec<_>>();
        session.payload.accounts.insert(
            0,
            VaultAccount {
                id: Uuid::new_v4().to_string(),
                name: incoming.name.trim().to_string(),
                email: incoming.email.trim().to_string(),
                emails,
                password: incoming.password.clone(),
                totp_secret: incoming.totp_secret.replace(' ', "").to_uppercase(),
                group_id: selected_group.clone(),
                note: incoming.note.trim().to_string(),
                avatar_url: incoming.avatar_url.clone(),
                github_created_at: incoming.github_created_at.clone(),
                created_at: now.clone(),
                updated_at: now.clone(),
            },
        );
    }
    append_log(
        &mut session.payload.local_api,
        make_log(
            "LOCAL",
            "/v1/import-requests",
            "import_approved",
            "success",
            &pending.application,
            None,
            if selected_group.is_empty() {
                None
            } else {
                Some(selected_group)
            },
            pending.accounts.len(),
            &pending.remote_address,
            format!(
                "Approved and encrypted {} account(s)",
                pending.accounts.len()
            ),
        ),
    );
    crate::vault::validate_payload(&session.payload)?;
    persist_session_payload(&app, session)?;
    let payload = session.payload.clone();
    drop(security);

    let mut inner = runtime
        .inner
        .lock()
        .map_err(|_| "Local API runtime is unavailable".to_string())?;
    inner.pending.remove(&request_id);
    inner.receipts.insert(
        request_id.clone(),
        RequestReceipt {
            request_id,
            status: "approved".to_string(),
            updated_at: Utc::now().to_rfc3339(),
            detail: format!("Imported {} account(s)", pending.accounts.len()),
            expected_key_hash: None,
            export_group_id: None,
        },
    );
    drop(inner);
    notify_state_changed(&app);
    Ok(payload)
}

#[tauri::command]
pub fn deny_local_api_import(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    runtime: State<'_, LocalApiRuntime>,
    request_id: String,
) -> Result<VaultPayload, String> {
    let pending = runtime
        .inner
        .lock()
        .map_err(|_| "Local API runtime is unavailable".to_string())?
        .pending
        .get(&request_id)
        .cloned()
        .ok_or_else(|| "The import request no longer exists".to_string())?;
    let mut security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_mut()
        .ok_or_else(|| "Unlock the vault before rejecting an import".to_string())?;
    append_log(
        &mut session.payload.local_api,
        make_log(
            "LOCAL",
            "/v1/import-requests",
            "import_denied",
            "denied",
            &pending.application,
            None,
            None,
            pending.accounts.len(),
            &pending.remote_address,
            "The user rejected the import request",
        ),
    );
    persist_session_payload(&app, session)?;
    let payload = session.payload.clone();
    drop(security);

    let mut inner = runtime
        .inner
        .lock()
        .map_err(|_| "Local API runtime is unavailable".to_string())?;
    inner.pending.remove(&request_id);
    inner.receipts.insert(
        request_id.clone(),
        RequestReceipt {
            request_id,
            status: "denied".to_string(),
            updated_at: Utc::now().to_rfc3339(),
            detail: "The user rejected the import request".to_string(),
            expected_key_hash: None,
            export_group_id: None,
        },
    );
    drop(inner);
    notify_state_changed(&app);
    Ok(payload)
}

#[tauri::command]
pub fn approve_local_api_export(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    runtime: State<'_, LocalApiRuntime>,
    request_id: String,
    auth_kind: String,
    credential: String,
) -> Result<VaultPayload, String> {
    let pending = runtime
        .inner
        .lock()
        .map_err(|_| "Local API runtime is unavailable".to_string())?
        .pending_exports
        .get(&request_id)
        .cloned()
        .ok_or_else(|| "The account read request no longer exists".to_string())?;
    let mut security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_mut()
        .ok_or_else(|| "Unlock the vault before approving an account read".to_string())?;
    verify_action_secret(&app, session, &auth_kind, &credential)?;
    if !session.payload.local_api.export_enabled {
        return Err("Account export is paused".to_string());
    }
    let key = session
        .payload
        .local_api
        .api_keys
        .iter_mut()
        .find(|key| key.enabled && key.id == pending.api_key_id && key.group_id == pending.group_id)
        .ok_or_else(|| "The API key was disabled or deleted".to_string())?;
    key.last_used_at = Some(Utc::now().to_rfc3339());
    append_log(
        &mut session.payload.local_api,
        make_log(
            "LOCAL",
            "/v1/accounts/query",
            "account_export",
            "success",
            &pending.application,
            Some(pending.api_key_name.clone()),
            Some(pending.group_id.clone()),
            pending.accounts.len(),
            &pending.remote_address,
            format!("Approved access to group {}", pending.group_name),
        ),
    );
    persist_session_payload(&app, session)?;
    let payload = session.payload.clone();
    drop(security);

    let mut inner = runtime
        .inner
        .lock()
        .map_err(|_| "Local API runtime is unavailable".to_string())?;
    inner.pending_exports.remove(&request_id);
    let receipt = inner
        .receipts
        .get_mut(&request_id)
        .ok_or_else(|| "The account read receipt no longer exists".to_string())?;
    receipt.status = "approved".to_string();
    receipt.updated_at = Utc::now().to_rfc3339();
    receipt.detail = format!("Approved access to {} account(s)", pending.accounts.len());
    drop(inner);
    notify_state_changed(&app);
    Ok(payload)
}

#[tauri::command]
pub fn deny_local_api_export(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    runtime: State<'_, LocalApiRuntime>,
    request_id: String,
) -> Result<VaultPayload, String> {
    let pending = runtime
        .inner
        .lock()
        .map_err(|_| "Local API runtime is unavailable".to_string())?
        .pending_exports
        .get(&request_id)
        .cloned()
        .ok_or_else(|| "The account read request no longer exists".to_string())?;
    let mut security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_mut()
        .ok_or_else(|| "Unlock the vault before rejecting an account read".to_string())?;
    append_log(
        &mut session.payload.local_api,
        make_log(
            "LOCAL",
            "/v1/accounts/query",
            "account_export",
            "denied",
            &pending.application,
            Some(pending.api_key_name.clone()),
            Some(pending.group_id.clone()),
            pending.accounts.len(),
            &pending.remote_address,
            "The user rejected the account read request",
        ),
    );
    persist_session_payload(&app, session)?;
    let payload = session.payload.clone();
    drop(security);

    let mut inner = runtime
        .inner
        .lock()
        .map_err(|_| "Local API runtime is unavailable".to_string())?;
    inner.pending_exports.remove(&request_id);
    let receipt = inner
        .receipts
        .get_mut(&request_id)
        .ok_or_else(|| "The account read receipt no longer exists".to_string())?;
    receipt.status = "denied".to_string();
    receipt.updated_at = Utc::now().to_rfc3339();
    receipt.detail = "The user rejected the account read request".to_string();
    drop(inner);
    notify_state_changed(&app);
    Ok(payload)
}

#[tauri::command]
pub fn create_local_api_key(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    name: String,
    group_id: String,
    auth_kind: String,
    credential: String,
) -> Result<CreatedApiKey, String> {
    let name = name.trim();
    if name.is_empty() || name.len() > 128 {
        return Err("Enter a valid API key name".to_string());
    }
    let mut security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_mut()
        .ok_or_else(|| "Unlock the vault before creating an API key".to_string())?;
    if !session
        .payload
        .groups
        .iter()
        .any(|group| group.id == group_id)
    {
        return Err("Select an existing group for this API key".to_string());
    }
    verify_action_secret(&app, session, &auth_kind, &credential)?;
    let mut random = [0_u8; 32];
    OsRng.fill_bytes(&mut random);
    let api_key = format!("gha_{}", URL_SAFE_NO_PAD.encode(random));
    let record = LocalApiKey {
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
        key_hash: key_hash(&api_key),
        group_id: group_id.clone(),
        enabled: true,
        created_at: Utc::now().to_rfc3339(),
        last_used_at: None,
    };
    session.payload.local_api.api_keys.push(record);
    let internal_app = ClientApplication {
        name: "Github Auth".to_string(),
        developer: "Local user".to_string(),
        icon: "data:image/svg+xml;base64,PHN2Zy8+".to_string(),
        description: "Local API administration".to_string(),
    };
    append_log(
        &mut session.payload.local_api,
        make_log(
            "LOCAL",
            "/settings/local-api",
            "api_key_created",
            "success",
            &internal_app,
            Some(name.to_string()),
            Some(group_id),
            0,
            "127.0.0.1",
            "Created a group-scoped API key",
        ),
    );
    persist_session_payload(&app, session)?;
    let config = session.payload.local_api.clone();
    notify_state_changed(&app);
    Ok(CreatedApiKey { api_key, config })
}

#[tauri::command]
pub fn set_local_api_export_enabled(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    enabled: bool,
    auth_kind: Option<String>,
    credential: Option<String>,
) -> Result<LocalApiConfig, String> {
    let mut security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_mut()
        .ok_or_else(|| "Unlock the vault before changing the local API".to_string())?;
    if enabled && !session.payload.local_api.export_enabled {
        verify_action_secret(
            &app,
            session,
            auth_kind.as_deref().unwrap_or_default(),
            credential.as_deref().unwrap_or_default(),
        )?;
    }
    session.payload.local_api.export_enabled = enabled;
    persist_session_payload(&app, session)?;
    let config = session.payload.local_api.clone();
    notify_state_changed(&app);
    Ok(config)
}

#[tauri::command]
pub fn set_local_api_key_enabled(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    key_id: String,
    enabled: bool,
) -> Result<LocalApiConfig, String> {
    let mut security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_mut()
        .ok_or_else(|| "Unlock the vault before changing an API key".to_string())?;
    let key = session
        .payload
        .local_api
        .api_keys
        .iter_mut()
        .find(|key| key.id == key_id)
        .ok_or_else(|| "The API key no longer exists".to_string())?;
    key.enabled = enabled;
    persist_session_payload(&app, session)?;
    let config = session.payload.local_api.clone();
    notify_state_changed(&app);
    Ok(config)
}

#[tauri::command]
pub fn delete_local_api_key(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    key_id: String,
) -> Result<LocalApiConfig, String> {
    let mut security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_mut()
        .ok_or_else(|| "Unlock the vault before deleting an API key".to_string())?;
    let original_len = session.payload.local_api.api_keys.len();
    session
        .payload
        .local_api
        .api_keys
        .retain(|key| key.id != key_id);
    if original_len == session.payload.local_api.api_keys.len() {
        return Err("The API key no longer exists".to_string());
    }
    persist_session_payload(&app, session)?;
    let config = session.payload.local_api.clone();
    notify_state_changed(&app);
    Ok(config)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn application() -> ClientApplication {
        ClientApplication {
            name: "Example Tool".to_string(),
            developer: "Example Studio".to_string(),
            icon: "https://example.com/icon.png".to_string(),
            description: "Imports local GitHub accounts".to_string(),
        }
    }

    #[test]
    fn requires_complete_application_identity_and_safe_icon_sources() {
        assert!(validate_application(&application()).is_ok());

        let mut missing_developer = application();
        missing_developer.developer.clear();
        assert!(validate_application(&missing_developer).is_err());

        let mut unsafe_icon = application();
        unsafe_icon.icon = "data:image/svg+xml;base64,PHN2Zy8+".to_string();
        assert!(validate_application(&unsafe_icon).is_err());
    }

    #[test]
    fn import_requires_name_email_password_and_enforces_batch_limit() {
        let valid = IncomingAccount {
            name: "octocat".to_string(),
            email: "octo@example.com".to_string(),
            password: "secret".to_string(),
            emails: Vec::new(),
            totp_secret: String::new(),
            note: String::new(),
            avatar_url: None,
            github_created_at: None,
        };
        assert!(validate_import(&ImportRequestBody {
            application: application(),
            accounts: vec![valid.clone()],
        })
        .is_ok());

        let mut missing_password = valid;
        missing_password.password.clear();
        assert!(validate_import(&ImportRequestBody {
            application: application(),
            accounts: vec![missing_password],
        })
        .is_err());
        assert!(validate_import(&ImportRequestBody {
            application: application(),
            accounts: Vec::new(),
        })
        .is_err());
    }

    #[test]
    fn api_key_hash_never_contains_the_plaintext_key() {
        let plaintext = "gha_test-secret-value";
        let digest = key_hash(plaintext);
        assert_eq!(digest.len(), 64);
        assert!(!digest.contains(plaintext));
        assert_eq!(digest, key_hash(plaintext));
    }

    #[test]
    fn pending_requests_expire_after_ten_minutes() {
        assert!(!is_expired(&Utc::now().to_rfc3339()));
        assert!(is_expired(
            &(Utc::now() - chrono::Duration::minutes(11)).to_rfc3339()
        ));
        assert!(is_expired("not-a-date"));
    }
}
