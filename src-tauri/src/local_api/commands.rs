use std::sync::{atomic::Ordering, Arc};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{Duration, Utc};
use rand::{rngs::OsRng, RngCore};
use serde::Serialize;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::vault::{VaultAccount, VaultEmail, VaultGroup, VaultPayload};
use crate::{persist_session_payload, state_lock, verify_action_secret, AppSecurityState};

use super::{
    audit::{self, AuditContext},
    envelope::{decode_x25519_public, decrypt_request, encrypt_response},
    identity::LocalIdentity,
    models::{
        ApproveImportInput, ClientApplication, CreatedApiKey, ImportRequestBody, LocalApiConfig,
        LocalApiKey, LocalApiRuntimeStatus, PairedClient, PendingApiExport, PendingApiImport,
        PendingPairing, LOCAL_API_PORT, PENDING_TTL_SECONDS, PROTOCOL_VERSION,
    },
    notify_state_changed,
    permissions::key_hash,
    replay::ReplayGuard,
    tls, LocalApiRuntime, ReceiptKind,
};

#[tauri::command]
pub fn get_local_api_runtime_status(
    runtime: State<'_, LocalApiRuntime>,
) -> Result<LocalApiRuntimeStatus, String> {
    let identity = runtime.current_identity()?;
    let base_url = format!("https://127.0.0.1:{LOCAL_API_PORT}/v2");
    Ok(LocalApiRuntimeStatus {
        listening: runtime.listening.load(Ordering::SeqCst),
        import_endpoint: format!("{base_url}/import-requests"),
        account_endpoint: format!("{base_url}/account-requests"),
        pairing_endpoint: format!("{base_url}/pairing-requests"),
        base_url,
        protocol_version: PROTOCOL_VERSION,
        tls13: true,
        mtls: true,
        instance_id: identity.instance_id().to_string(),
        spki_fingerprint: identity.spki_fingerprint()?,
        server_encryption_public_key: identity.encryption_public_key()?,
    })
}

#[tauri::command]
pub fn export_local_api_connection(
    app: AppHandle,
    runtime: State<'_, LocalApiRuntime>,
) -> Result<Option<String>, String> {
    let identity = runtime.current_identity()?;
    let Some(path) = rfd::FileDialog::new()
        .set_title("Export Github Auth local connection")
        .set_file_name("github-auth-local-connection.json")
        .add_filter("JSON", &["json"])
        .save_file()
    else {
        return Ok(None);
    };
    let bytes = serde_json::to_vec_pretty(&identity.connection_config()?)
        .map_err(|_| "Unable to serialize the connection configuration".to_string())?;
    crate::storage::atomic_write(&path, &bytes)?;
    let _ = app;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn get_pending_api_pairings(
    runtime: State<'_, LocalApiRuntime>,
) -> Result<Vec<PendingPairing>, String> {
    let inner = runtime
        .inner
        .lock()
        .map_err(|_| "Local API runtime is unavailable".to_string())?;
    let mut pending = inner
        .pairings
        .values()
        .map(|record| record.preview.clone())
        .filter(|request| !expired(&request.requested_at))
        .collect::<Vec<_>>();
    pending.sort_by(|left, right| left.requested_at.cmp(&right.requested_at));
    Ok(pending)
}

#[tauri::command]
pub fn get_pending_api_imports(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    runtime: State<'_, LocalApiRuntime>,
) -> Result<Vec<PendingApiImport>, String> {
    let security = state_lock(&state)?;
    if security.unlocked.is_none() {
        return Ok(Vec::new());
    }
    let identity = runtime.current_identity()?;
    let records = runtime
        .inner
        .lock()
        .map_err(|_| "Local API runtime is unavailable".to_string())?
        .imports
        .values()
        .cloned()
        .collect::<Vec<_>>();
    let mut pending = Vec::new();
    for record in records {
        let body = decrypt_request::<ImportRequestBody>(
            &record.envelope,
            identity.instance_id(),
            "/v2/import-requests",
            identity.encryption_secret()?,
        )?;
        if expired(&record.envelope.timestamp) {
            continue;
        }
        pending.push(PendingApiImport {
            id: record.envelope.request_id.clone(),
            client_id: record.envelope.client_id.clone(),
            application: body.application.clone(),
            purpose: body.purpose.clone(),
            accounts: body.accounts.clone(),
            requested_at: record.envelope.timestamp,
            remote_address: record.remote_address,
            source_pid: record.source_pid,
            executable_sha256: record.executable_sha256,
            authenticode_publisher: record.authenticode_publisher,
            signature_status: record.signature_status,
        });
    }
    drop(security);
    pending.sort_by(|left, right| left.requested_at.cmp(&right.requested_at));
    let _ = app;
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
    let mut pending = inner
        .exports
        .values()
        .map(|record| record.preview.clone())
        .filter(|request| !expired(&request.requested_at))
        .collect::<Vec<_>>();
    pending.sort_by(|left, right| left.requested_at.cmp(&right.requested_at));
    Ok(pending)
}

#[tauri::command]
pub fn approve_local_api_pairing(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    runtime: State<'_, LocalApiRuntime>,
    request_id: String,
    auth_kind: String,
    credential: String,
) -> Result<VaultPayload, String> {
    let record = runtime
        .inner
        .lock()
        .map_err(|_| "Local API runtime is unavailable".to_string())?
        .pairings
        .get(&request_id)
        .cloned()
        .ok_or_else(|| "The pairing request no longer exists".to_string())?;
    if expired(&record.preview.requested_at) {
        return Err("The pairing request expired".to_string());
    }
    let identity = runtime.current_identity()?;
    let signed = identity.sign_client_csr(&record.csr_pem)?;
    let mut security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_mut()
        .ok_or_else(|| "Unlock the vault before approving a client".to_string())?;
    verify_action_secret(&app, session, &auth_kind, &credential)?;
    if session
        .payload
        .local_api
        .clients
        .iter()
        .any(|client| client.id == record.preview.client_id)
    {
        return Err("This clientId is already paired".to_string());
    }
    if let Some(key_id) = &record.api_key_id {
        let key = session
            .payload
            .local_api
            .api_keys
            .iter_mut()
            .find(|key| {
                key.id == *key_id
                    && (key.enabled || key.requires_repair)
                    && key.client_id.is_none()
                    && record.preview.group_id.as_deref() == Some(key.group_id.as_str())
            })
            .ok_or_else(|| "The API key can no longer be paired".to_string())?;
        key.client_id = Some(record.preview.client_id.clone());
        key.requires_repair = false;
        key.enabled = true;
    }
    let client = PairedClient {
        id: record.preview.client_id.clone(),
        application_name: record.preview.application.name.trim().to_string(),
        developer: record.preview.application.developer.trim().to_string(),
        description: record.preview.application.description.trim().to_string(),
        icon: record.preview.application.icon.trim().to_string(),
        certificate_fingerprint: signed.fingerprint.clone(),
        encryption_public_key: base64::engine::general_purpose::STANDARD
            .encode(record.encryption_public_key),
        executable_path: record.preview.executable_path.clone(),
        executable_sha256: record.preview.executable_sha256.clone(),
        authenticode_publisher: record.preview.authenticode_publisher.clone(),
        signature_status: record.preview.signature_status.clone(),
        allow_import: record.preview.allow_import,
        allow_read: record.preview.allow_read,
        group_id: record.preview.group_id.clone(),
        enabled: true,
        created_at: Utc::now().to_rfc3339(),
        expires_at: signed.expires_at.clone(),
        last_used_at: None,
    };
    session.payload.local_api.clients.push(client.clone());
    audit::append(
        &mut session.payload.local_api,
        AuditContext {
            route: "/v2/pairing-requests",
            action: "client_paired",
            outcome: "success",
            application: &record.preview.application,
            client: Some(&client),
            api_key_name: None,
            group_id: client.group_id.clone(),
            account_count: 0,
            source_pid: record.preview.source_pid,
            remote_address: &record.preview.remote_address,
            request_id: Some(request_id.clone()),
            detail: "Signed a short-lived client certificate after user verification".to_string(),
        },
    );
    crate::vault::validate_payload(&session.payload)?;
    persist_session_payload(&app, session)?;
    let payload = session.payload.clone();
    drop(security);

    let response = encrypt_response(
        &serde_json::json!({
            "requestId": request_id,
            "status": "approved",
            "clientId": client.id,
            "clientCertificate": signed.certificate_pem,
            "caCertificate": identity.connection_config()?.ca_certificate_pem,
            "expiresAt": signed.expires_at
        }),
        identity.instance_id(),
        &record.preview.client_id,
        &request_id,
        "/v2/pairing-responses",
        record.encryption_public_key,
    )?;
    let mut inner = runtime
        .inner
        .lock()
        .map_err(|_| "Local API runtime is unavailable".to_string())?;
    inner.pairings.remove(&request_id);
    let receipt = inner
        .receipts
        .get_mut(&request_id)
        .ok_or_else(|| "The pairing receipt no longer exists".to_string())?;
    receipt.status = "approved".to_string();
    receipt.updated_at = Utc::now().to_rfc3339();
    receipt.detail = "Client certificate issued".to_string();
    receipt.encrypted_response = Some(response);
    drop(inner);
    notify_state_changed(&app);
    Ok(payload)
}

#[tauri::command]
pub fn deny_local_api_pairing(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    runtime: State<'_, LocalApiRuntime>,
    request_id: String,
) -> Result<(), String> {
    let record = runtime
        .inner
        .lock()
        .map_err(|_| "Local API runtime is unavailable".to_string())?
        .pairings
        .get(&request_id)
        .cloned()
        .ok_or_else(|| "The pairing request no longer exists".to_string())?;
    let mut security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_mut()
        .ok_or_else(|| "Unlock the vault before rejecting a client".to_string())?;
    audit::append(
        &mut session.payload.local_api,
        AuditContext {
            route: "/v2/pairing-requests",
            action: "client_pairing_denied",
            outcome: "denied",
            application: &record.preview.application,
            client: None,
            api_key_name: None,
            group_id: record.preview.group_id.clone(),
            account_count: 0,
            source_pid: record.preview.source_pid,
            remote_address: &record.preview.remote_address,
            request_id: Some(request_id.clone()),
            detail: "The user rejected the pairing request".to_string(),
        },
    );
    persist_session_payload(&app, session)?;
    drop(security);
    let identity = runtime.current_identity()?;
    let response = encrypt_response(
        &serde_json::json!({
            "requestId": request_id,
            "status": "denied",
            "detail": "The user rejected the pairing request"
        }),
        identity.instance_id(),
        &record.preview.client_id,
        &request_id,
        "/v2/pairing-responses",
        record.encryption_public_key,
    )?;
    let mut inner = runtime
        .inner
        .lock()
        .map_err(|_| "Local API runtime is unavailable".to_string())?;
    inner.pairings.remove(&request_id);
    let receipt = inner
        .receipts
        .get_mut(&request_id)
        .ok_or_else(|| "The pairing receipt no longer exists".to_string())?;
    receipt.status = "denied".to_string();
    receipt.updated_at = Utc::now().to_rfc3339();
    receipt.detail = "The user rejected the pairing request".to_string();
    receipt.encrypted_response = Some(response);
    drop(inner);
    notify_state_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn approve_local_api_import(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    runtime: State<'_, LocalApiRuntime>,
    input: ApproveImportInput,
) -> Result<VaultPayload, String> {
    let record = runtime
        .inner
        .lock()
        .map_err(|_| "Local API runtime is unavailable".to_string())?
        .imports
        .get(&input.request_id)
        .cloned()
        .ok_or_else(|| "The import request no longer exists".to_string())?;
    if expired(&record.envelope.timestamp) {
        return Err("The import request expired".to_string());
    }
    let identity = runtime.current_identity()?;
    let body = decrypt_request::<ImportRequestBody>(
        &record.envelope,
        identity.instance_id(),
        "/v2/import-requests",
        identity.encryption_secret()?,
    )?;
    let mut security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_mut()
        .ok_or_else(|| "Unlock the vault before approving an import".to_string())?;
    verify_action_secret(&app, session, &input.auth_kind, &input.credential)?;
    let client = session
        .payload
        .local_api
        .clients
        .iter()
        .find(|client| {
            client.id == record.envelope.client_id && client.enabled && client.allow_import
        })
        .cloned()
        .ok_or_else(|| "The paired client was paused or revoked".to_string())?;
    let selected_group = select_import_group(
        &mut session.payload,
        input.group_id.clone(),
        input.new_group_name.clone(),
    )?;
    let now = Utc::now().to_rfc3339();
    for incoming in &body.accounts {
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
            .collect();
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
    audit::append(
        &mut session.payload.local_api,
        AuditContext {
            route: "/v2/import-requests",
            action: "import_approved",
            outcome: "success",
            application: &body.application,
            client: Some(&client),
            api_key_name: None,
            group_id: (!selected_group.is_empty()).then_some(selected_group.clone()),
            account_count: body.accounts.len(),
            source_pid: record.source_pid,
            remote_address: &record.remote_address,
            request_id: Some(input.request_id.clone()),
            detail: format!("Approved and encrypted {} account(s)", body.accounts.len()),
        },
    );
    crate::vault::validate_payload(&session.payload)?;
    persist_session_payload(&app, session)?;
    let payload = session.payload.clone();
    drop(security);

    let mut inner = runtime
        .inner
        .lock()
        .map_err(|_| "Local API runtime is unavailable".to_string())?;
    inner.imports.remove(&input.request_id);
    let receipt = inner
        .receipts
        .get_mut(&input.request_id)
        .ok_or_else(|| "The import receipt no longer exists".to_string())?;
    receipt.status = "approved".to_string();
    receipt.updated_at = Utc::now().to_rfc3339();
    receipt.detail = format!("Imported {} account(s)", body.accounts.len());
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
    let record = runtime
        .inner
        .lock()
        .map_err(|_| "Local API runtime is unavailable".to_string())?
        .imports
        .get(&request_id)
        .cloned()
        .ok_or_else(|| "The import request no longer exists".to_string())?;
    let identity = runtime.current_identity()?;
    let body = decrypt_request::<ImportRequestBody>(
        &record.envelope,
        identity.instance_id(),
        "/v2/import-requests",
        identity.encryption_secret()?,
    )?;
    let mut security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_mut()
        .ok_or_else(|| "Unlock the vault before rejecting an import".to_string())?;
    let client = session
        .payload
        .local_api
        .clients
        .iter()
        .find(|client| client.id == record.envelope.client_id)
        .cloned();
    audit::append(
        &mut session.payload.local_api,
        AuditContext {
            route: "/v2/import-requests",
            action: "import_denied",
            outcome: "denied",
            application: &body.application,
            client: client.as_ref(),
            api_key_name: None,
            group_id: None,
            account_count: body.accounts.len(),
            source_pid: record.source_pid,
            remote_address: &record.remote_address,
            request_id: Some(request_id.clone()),
            detail: "The user rejected the import request".to_string(),
        },
    );
    persist_session_payload(&app, session)?;
    let payload = session.payload.clone();
    drop(security);
    resolve_without_payload(
        &runtime,
        &request_id,
        ReceiptKind::Import,
        "denied",
        "The user rejected the import request",
    )?;
    notify_state_changed(&app);
    Ok(payload)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountResponse<'a> {
    request_id: &'a str,
    status: &'static str,
    group: &'a VaultGroup,
    accounts: Vec<&'a VaultAccount>,
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
        .exports
        .get(&request_id)
        .map(|record| record.preview.clone())
        .ok_or_else(|| "The account read request no longer exists".to_string())?;
    if expired(&pending.requested_at) {
        return Err("The account read request expired".to_string());
    }
    let identity = runtime.current_identity()?;
    let mut security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_mut()
        .ok_or_else(|| "Unlock the vault before approving an account read".to_string())?;
    verify_action_secret(&app, session, &auth_kind, &credential)?;
    if !session.payload.local_api.export_enabled {
        return Err("Account reads are paused".to_string());
    }
    let client = session
        .payload
        .local_api
        .clients
        .iter()
        .find(|client| {
            client.id == pending.client_id
                && client.enabled
                && client.allow_read
                && client.group_id.as_deref() == Some(pending.group_id.as_str())
        })
        .cloned()
        .ok_or_else(|| "The paired client was paused or revoked".to_string())?;
    let key_index = session
        .payload
        .local_api
        .api_keys
        .iter()
        .position(|key| {
            key.id == pending.api_key_id
                && key.enabled
                && key.client_id.as_deref() == Some(client.id.as_str())
                && key.group_id == pending.group_id
                && key
                    .expires_at
                    .as_deref()
                    .is_none_or(|value| !expired_at(value))
        })
        .ok_or_else(|| "The API key was disabled, expired or deleted".to_string())?;
    let group = session
        .payload
        .groups
        .iter()
        .find(|group| group.id == pending.group_id)
        .ok_or_else(|| "The authorized group was deleted".to_string())?;
    let accounts = session
        .payload
        .accounts
        .iter()
        .filter(|account| !account.group_id.is_empty() && account.group_id == pending.group_id)
        .collect::<Vec<_>>();
    let client_public = decode_x25519_public(&client.encryption_public_key)?;
    let encrypted_response = encrypt_response(
        &AccountResponse {
            request_id: &request_id,
            status: "approved",
            group,
            accounts,
        },
        identity.instance_id(),
        &client.id,
        &request_id,
        "/v2/account-responses",
        client_public,
    )?;
    session.payload.local_api.api_keys[key_index].last_used_at = Some(Utc::now().to_rfc3339());
    if let Some(client_record) = session
        .payload
        .local_api
        .clients
        .iter_mut()
        .find(|value| value.id == client.id)
    {
        client_record.last_used_at = Some(Utc::now().to_rfc3339());
    }
    audit::append(
        &mut session.payload.local_api,
        AuditContext {
            route: "/v2/account-requests",
            action: "account_approved",
            outcome: "success",
            application: &pending.application,
            client: Some(&client),
            api_key_name: Some(pending.api_key_name.clone()),
            group_id: Some(pending.group_id.clone()),
            account_count: pending.accounts.len(),
            source_pid: pending.source_pid,
            remote_address: &pending.remote_address,
            request_id: Some(request_id.clone()),
            detail: "Approved a one-time encrypted account response".to_string(),
        },
    );
    persist_session_payload(&app, session)?;
    let payload = session.payload.clone();
    drop(security);

    let mut inner = runtime
        .inner
        .lock()
        .map_err(|_| "Local API runtime is unavailable".to_string())?;
    inner.exports.remove(&request_id);
    let receipt = inner
        .receipts
        .get_mut(&request_id)
        .ok_or_else(|| "The account read receipt no longer exists".to_string())?;
    receipt.status = "approved".to_string();
    receipt.updated_at = Utc::now().to_rfc3339();
    receipt.detail = "The encrypted account response is ready for one-time delivery".to_string();
    receipt.encrypted_response = Some(encrypted_response);
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
        .exports
        .get(&request_id)
        .map(|record| record.preview.clone())
        .ok_or_else(|| "The account read request no longer exists".to_string())?;
    let mut security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_mut()
        .ok_or_else(|| "Unlock the vault before rejecting an account read".to_string())?;
    let client = session
        .payload
        .local_api
        .clients
        .iter()
        .find(|client| client.id == pending.client_id)
        .cloned();
    audit::append(
        &mut session.payload.local_api,
        AuditContext {
            route: "/v2/account-requests",
            action: "account_denied",
            outcome: "denied",
            application: &pending.application,
            client: client.as_ref(),
            api_key_name: Some(pending.api_key_name.clone()),
            group_id: Some(pending.group_id.clone()),
            account_count: pending.accounts.len(),
            source_pid: pending.source_pid,
            remote_address: &pending.remote_address,
            request_id: Some(request_id.clone()),
            detail: "The user rejected the account read request".to_string(),
        },
    );
    persist_session_payload(&app, session)?;
    let payload = session.payload.clone();
    drop(security);
    resolve_without_payload(
        &runtime,
        &request_id,
        ReceiptKind::Account,
        "denied",
        "The user rejected the account read request",
    )?;
    notify_state_changed(&app);
    Ok(payload)
}

#[tauri::command]
pub fn create_local_api_key(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    name: String,
    group_id: String,
    expires_in_days: Option<u32>,
    auth_kind: String,
    credential: String,
) -> Result<CreatedApiKey, String> {
    let name = name.trim();
    if name.is_empty() || name.len() > 128 {
        return Err("Enter a valid API key name".to_string());
    }
    let days = expires_in_days.unwrap_or(90);
    if !(1..=365).contains(&days) {
        return Err("API keys must expire between 1 and 365 days".to_string());
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
    let key_id = Uuid::new_v4().to_string();
    session.payload.local_api.api_keys.push(LocalApiKey {
        id: key_id.clone(),
        name: name.to_string(),
        key_hash: key_hash(&api_key),
        group_id: group_id.clone(),
        client_id: None,
        requires_repair: false,
        enabled: true,
        created_at: Utc::now().to_rfc3339(),
        expires_at: Some((Utc::now() + Duration::days(i64::from(days))).to_rfc3339()),
        last_used_at: None,
    });
    audit::append(
        &mut session.payload.local_api,
        AuditContext {
            route: "/settings/local-api",
            action: "api_key_created",
            outcome: "success",
            application: &internal_application(),
            client: None,
            api_key_name: Some(name.to_string()),
            group_id: Some(group_id),
            account_count: 0,
            source_pid: None,
            remote_address: "127.0.0.1",
            request_id: None,
            detail: "Created a group-scoped API key that requires client pairing".to_string(),
        },
    );
    persist_session_payload(&app, session)?;
    let config = session.payload.local_api.clone();
    notify_state_changed(&app);
    Ok(CreatedApiKey {
        key_id,
        api_key,
        config,
    })
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

#[tauri::command]
pub fn set_local_api_client_enabled(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    client_id: String,
    enabled: bool,
) -> Result<LocalApiConfig, String> {
    let mut security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_mut()
        .ok_or_else(|| "Unlock the vault before changing a client".to_string())?;
    let client = session
        .payload
        .local_api
        .clients
        .iter_mut()
        .find(|client| client.id == client_id)
        .ok_or_else(|| "The paired client no longer exists".to_string())?;
    client.enabled = enabled;
    persist_session_payload(&app, session)?;
    let config = session.payload.local_api.clone();
    notify_state_changed(&app);
    Ok(config)
}

#[tauri::command]
pub fn revoke_local_api_client(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    client_id: String,
) -> Result<LocalApiConfig, String> {
    let mut security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_mut()
        .ok_or_else(|| "Unlock the vault before revoking a client".to_string())?;
    let original_len = session.payload.local_api.clients.len();
    session
        .payload
        .local_api
        .clients
        .retain(|client| client.id != client_id);
    if original_len == session.payload.local_api.clients.len() {
        return Err("The paired client no longer exists".to_string());
    }
    for key in &mut session.payload.local_api.api_keys {
        if key.client_id.as_deref() == Some(client_id.as_str()) {
            key.enabled = false;
        }
    }
    persist_session_payload(&app, session)?;
    let config = session.payload.local_api.clone();
    notify_state_changed(&app);
    Ok(config)
}

#[tauri::command]
pub fn rotate_local_api_identity(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    runtime: State<'_, LocalApiRuntime>,
    auth_kind: String,
    credential: String,
) -> Result<VaultPayload, String> {
    let mut security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_mut()
        .ok_or_else(|| "Unlock the vault before rotating the local API identity".to_string())?;
    verify_action_secret(&app, session, &auth_kind, &credential)?;
    session.payload.local_api.clients.clear();
    for key in &mut session.payload.local_api.api_keys {
        key.enabled = false;
        key.client_id = None;
        key.requires_repair = true;
    }
    session.payload.local_api.export_enabled = false;
    persist_session_payload(&app, session)?;
    let payload = session.payload.clone();
    drop(security);

    runtime.clear_pending();
    ReplayGuard::clear(&app)?;
    LocalIdentity::reset(&app)?;
    let identity = Arc::new(LocalIdentity::load_or_create(&app)?);
    let tls_config = tls::server_config(&identity)?;
    *runtime
        .identity
        .write()
        .map_err(|_| "The local API identity lock is unavailable".to_string())? = Some(identity);
    *runtime
        .tls_config
        .write()
        .map_err(|_| "The local TLS configuration lock is unavailable".to_string())? =
        Some(tls_config);
    *runtime
        .replay
        .lock()
        .map_err(|_| "The replay cache is unavailable".to_string())? =
        Some(ReplayGuard::load(&app)?);
    notify_state_changed(&app);
    Ok(payload)
}

fn select_import_group(
    payload: &mut VaultPayload,
    group_id: Option<String>,
    new_group_name: Option<String>,
) -> Result<String, String> {
    if let Some(requested_name) = new_group_name {
        let name = requested_name.trim();
        if name.is_empty() || name.len() > 256 {
            return Err("Enter a valid group name".to_string());
        }
        let group = VaultGroup {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            color: "#A855F7".to_string(),
            created_at: Utc::now().to_rfc3339(),
        };
        let id = group.id.clone();
        payload.groups.push(group);
        return Ok(id);
    }
    if let Some(id) = group_id.filter(|id| !id.is_empty()) {
        if !payload.groups.iter().any(|group| group.id == id) {
            return Err("The selected group no longer exists".to_string());
        }
        return Ok(id);
    }
    Ok(String::new())
}

fn resolve_without_payload(
    runtime: &LocalApiRuntime,
    request_id: &str,
    kind: ReceiptKind,
    status: &str,
    detail: &str,
) -> Result<(), String> {
    let mut inner = runtime
        .inner
        .lock()
        .map_err(|_| "Local API runtime is unavailable".to_string())?;
    match kind {
        ReceiptKind::Import => {
            inner.imports.remove(request_id);
        }
        ReceiptKind::Account => {
            inner.exports.remove(request_id);
        }
        ReceiptKind::Pairing => {
            inner.pairings.remove(request_id);
        }
    }
    let receipt = inner
        .receipts
        .get_mut(request_id)
        .ok_or_else(|| "The request receipt no longer exists".to_string())?;
    receipt.status = status.to_string();
    receipt.updated_at = Utc::now().to_rfc3339();
    receipt.detail = detail.to_string();
    Ok(())
}

fn expired(value: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|time| time.with_timezone(&Utc) < Utc::now() - Duration::seconds(PENDING_TTL_SECONDS))
        .unwrap_or(true)
}

fn expired_at(value: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|time| time.with_timezone(&Utc) <= Utc::now())
        .unwrap_or(true)
}

fn internal_application() -> ClientApplication {
    ClientApplication {
        name: "Github Auth".to_string(),
        developer: "Local user".to_string(),
        icon: "data:image/png;base64,iVBORw0KGgo=".to_string(),
        description: "Local API administration".to_string(),
        executable_path: String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expired_key_and_pending_windows_fail_closed() {
        assert!(expired_at("2020-01-01T00:00:00Z"));
        assert!(expired("2020-01-01T00:00:00Z"));
        assert!(!expired(&(Utc::now() - Duration::seconds(1)).to_rfc3339()));
    }

    #[test]
    fn application_validation_rejects_scriptable_svg_icons() {
        let mut application = internal_application();
        assert!(super::super::permissions::validate_application(&application).is_ok());
        application.icon = "data:image/svg+xml;base64,PHN2Zy8+".to_string();
        assert!(super::super::permissions::validate_application(&application).is_err());
    }
}
