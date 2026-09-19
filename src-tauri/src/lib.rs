mod backup;
mod local_api;
mod quick_unlock;
mod storage;
mod vault;
mod windows_consent;

use std::{path::PathBuf, sync::Mutex, thread, time::Duration};

use chrono::{DateTime, Local, Utc};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

use backup::{BackupKind, BackupSettings, ImportMode};
use quick_unlock::{PendingTotpSetup, TotpSetupView};
use storage::{atomic_write, read_limited, vault_path};
use vault::{
    change_password, create_vault, encrypt_payload, parse_v2, serialize_v2, unlock_any,
    unlock_with_data_key, verify_password, UnlockedVault, VaultEnvelopeV2, VaultPayload,
    MAX_VAULT_BYTES,
};

struct UnlockedSession {
    envelope: VaultEnvelopeV2,
    data_key: Zeroizing<Vec<u8>>,
    payload: VaultPayload,
}

impl From<UnlockedVault> for UnlockedSession {
    fn from(unlocked: UnlockedVault) -> Self {
        Self {
            envelope: unlocked.envelope,
            data_key: unlocked.data_key,
            payload: unlocked.payload,
        }
    }
}

struct PendingInitialization {
    vault: UnlockedVault,
    totp: Option<PendingTotpSetup>,
}

struct PendingImport {
    token: String,
    payload: VaultPayload,
    created_at: String,
}

#[derive(Default)]
struct SecurityState {
    unlocked: Option<UnlockedSession>,
    pending_initialization: Option<PendingInitialization>,
    pending_rebind: Option<PendingTotpSetup>,
    pending_import: Option<PendingImport>,
}

#[derive(Default)]
struct AppSecurityState(Mutex<SecurityState>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultStatus {
    has_vault: bool,
    quick_unlock_enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UnlockView {
    payload: VaultPayload,
    quick_unlock_enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportPreview {
    token: String,
    account_count: usize,
    group_count: usize,
    created_at: String,
}

/// A forgotten master password is unrecoverable by design, so "reset" means:
/// verify identity, snapshot the encrypted vault, then wipe the local copy.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResetOutcome {
    backup_path: String,
    verified_by: String,
}

const RESET_ACKNOWLEDGMENT_PHRASE: &str = "永久重置";

fn state_lock<'a>(
    state: &'a State<'_, AppSecurityState>,
) -> Result<std::sync::MutexGuard<'a, SecurityState>, String> {
    state
        .0
        .lock()
        .map_err(|_| "Security state is unavailable".to_string())
}

fn persist_session_payload(app: &AppHandle, session: &mut UnlockedSession) -> Result<(), String> {
    let envelope = encrypt_payload(&session.envelope, &session.data_key, &session.payload)?;
    write_envelope(app, &envelope)?;
    session.envelope = envelope;
    Ok(())
}

fn verify_action_secret(
    app: &AppHandle,
    session: &UnlockedSession,
    auth_kind: &str,
    credential: &str,
) -> Result<(), String> {
    match auth_kind {
        "totp" => {
            let _ = quick_unlock::verify(app, &session.envelope.vault_id, credential)?;
            Ok(())
        }
        "password" => {
            let password = Zeroizing::new(credential.to_string());
            verify_password(&session.envelope, &session.data_key, &password)
        }
        _ => Err("Choose password or 2FA verification".to_string()),
    }
}

fn read_vault(app: &AppHandle) -> Result<Option<String>, String> {
    let Some(contents) = read_limited(&vault_path(app)?, MAX_VAULT_BYTES)? else {
        return Ok(None);
    };
    String::from_utf8(contents)
        .map(Some)
        .map_err(|_| "Encrypted vault is not valid UTF-8".to_string())
}

fn write_envelope(app: &AppHandle, envelope: &VaultEnvelopeV2) -> Result<(), String> {
    let serialized = serialize_v2(envelope)?;
    atomic_write(&vault_path(app)?, serialized.as_bytes())?;
    let written = read_vault(app)?.ok_or_else(|| "Encrypted vault was not written".to_string())?;
    if written != serialized {
        return Err("Encrypted vault verification failed after writing".to_string());
    }
    parse_v2(&written)?;
    Ok(())
}

fn ensure_vault_does_not_exist(app: &AppHandle) -> Result<(), String> {
    ensure_vault_file_does_not_exist(&vault_path(app)?)
}

fn ensure_vault_file_does_not_exist(path: &std::path::Path) -> Result<(), String> {
    if read_limited(path, MAX_VAULT_BYTES)?.is_some() {
        return Err("An encrypted vault already exists; unlock it instead".to_string());
    }
    Ok(())
}

#[tauri::command]
fn get_vault_status(app: AppHandle) -> Result<VaultStatus, String> {
    let Some(contents) = read_vault(&app)? else {
        return Ok(VaultStatus {
            has_vault: false,
            quick_unlock_enabled: false,
        });
    };
    let value: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|_| "Encrypted vault has an invalid format".to_string())?;
    let quick_unlock_enabled =
        if value.get("version").and_then(serde_json::Value::as_u64) == Some(2) {
            let envelope = parse_v2(&contents)?;
            quick_unlock::is_enabled(&app, Some(&envelope.vault_id))
        } else if value.get("version").and_then(serde_json::Value::as_u64) == Some(1) {
            false
        } else {
            return Err("Encrypted vault version is unsupported".to_string());
        };
    Ok(VaultStatus {
        has_vault: true,
        quick_unlock_enabled,
    })
}

#[tauri::command]
fn begin_initialization(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    password: String,
) -> Result<(), String> {
    ensure_vault_does_not_exist(&app)?;
    let password = Zeroizing::new(password);
    let mut security = state_lock(&state)?;
    if security.pending_initialization.is_some() {
        return Err("Initialization is already in progress".to_string());
    }
    let vault = create_vault(&password, VaultPayload::default())?;
    security.pending_initialization = Some(PendingInitialization { vault, totp: None });
    Ok(())
}

#[tauri::command]
fn cancel_initialization(state: State<'_, AppSecurityState>) -> Result<(), String> {
    state_lock(&state)?.pending_initialization = None;
    Ok(())
}

#[tauri::command]
fn begin_initial_totp_setup(state: State<'_, AppSecurityState>) -> Result<TotpSetupView, String> {
    let mut security = state_lock(&state)?;
    let pending = security
        .pending_initialization
        .as_mut()
        .ok_or_else(|| "Initialization has expired; enter the master password again".to_string())?;
    let (setup, view) = PendingTotpSetup::new()?;
    pending.totp = Some(setup);
    Ok(view)
}

#[tauri::command]
fn complete_password_initialization(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
) -> Result<UnlockView, String> {
    let mut security = state_lock(&state)?;
    ensure_vault_does_not_exist(&app)?;
    quick_unlock::disable(&app)?;
    let pending = security
        .pending_initialization
        .as_ref()
        .ok_or_else(|| "Initialization has expired; enter the master password again".to_string())?;
    write_envelope(&app, &pending.vault.envelope)?;
    let pending = security
        .pending_initialization
        .take()
        .expect("checked above");
    let payload = pending.vault.payload.clone();
    security.unlocked = Some(pending.vault.into());
    Ok(UnlockView {
        payload,
        quick_unlock_enabled: false,
    })
}

#[tauri::command]
fn confirm_initial_totp(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    code: String,
) -> Result<UnlockView, String> {
    let mut security = state_lock(&state)?;
    ensure_vault_does_not_exist(&app)?;
    let pending = security
        .pending_initialization
        .as_ref()
        .ok_or_else(|| "Initialization has expired; enter the master password again".to_string())?;
    let setup = pending
        .totp
        .as_ref()
        .ok_or_else(|| "Authenticator setup has expired".to_string())?;
    setup.verify(&code)?;
    quick_unlock::save(
        &app,
        &pending.vault.envelope.vault_id,
        setup.secret(),
        &pending.vault.data_key,
    )?;
    if let Err(error) = write_envelope(&app, &pending.vault.envelope) {
        let _ = quick_unlock::disable(&app);
        return Err(error);
    }
    let pending = security
        .pending_initialization
        .take()
        .expect("checked above");
    let payload = pending.vault.payload.clone();
    security.unlocked = Some(pending.vault.into());
    Ok(UnlockView {
        payload,
        quick_unlock_enabled: true,
    })
}

#[tauri::command]
fn unlock_with_password(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    password: String,
) -> Result<UnlockView, String> {
    let password = Zeroizing::new(password);
    let contents = read_vault(&app)?.ok_or_else(|| "Encrypted vault does not exist".to_string())?;
    let unlocked = unlock_any(&contents, &password)?;
    if unlocked.migrated {
        write_envelope(&app, &unlocked.envelope)?;
        quick_unlock::disable(&app)?;
    }
    let quick_unlock_enabled = quick_unlock::is_enabled(&app, Some(&unlocked.envelope.vault_id));
    let payload = unlocked.payload.clone();
    state_lock(&state)?.unlocked = Some(unlocked.into());
    Ok(UnlockView {
        payload,
        quick_unlock_enabled,
    })
}

#[tauri::command]
fn unlock_with_totp(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    code: String,
) -> Result<UnlockView, String> {
    let contents = read_vault(&app)?.ok_or_else(|| "Encrypted vault does not exist".to_string())?;
    let envelope = parse_v2(&contents)?;
    let quick = quick_unlock::verify(&app, &envelope.vault_id, &code)?;
    let unlocked = unlock_with_data_key(envelope, quick.data_key, false)?;
    let payload = unlocked.payload.clone();
    state_lock(&state)?.unlocked = Some(unlocked.into());
    Ok(UnlockView {
        payload,
        quick_unlock_enabled: true,
    })
}

#[tauri::command]
fn verify_totp_for_action(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    code: String,
) -> Result<(), String> {
    let security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_ref()
        .ok_or_else(|| "Unlock the vault before confirming this action".to_string())?;
    let _ = quick_unlock::verify(&app, &session.envelope.vault_id, &code)?;
    Ok(())
}

/// Destructive-action confirmation for vaults WITHOUT quick unlock (2FA):
/// the current master password plays the same "prove it's really the owner" role.
#[tauri::command]
fn verify_password_for_action(
    state: State<'_, AppSecurityState>,
    password: String,
) -> Result<(), String> {
    let password = Zeroizing::new(password);
    let security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_ref()
        .ok_or_else(|| "Unlock the vault before confirming this action".to_string())?;
    verify_password(&session.envelope, &session.data_key, &password)
}

#[tauri::command]
fn lock_vault(
    state: State<'_, AppSecurityState>,
    runtime: State<'_, local_api::LocalApiRuntime>,
) -> Result<(), String> {
    let mut security = state_lock(&state)?;
    security.unlocked = None;
    security.pending_initialization = None;
    security.pending_import = None;
    security.pending_rebind = None;
    local_api::on_vault_locked(&runtime);
    Ok(())
}

#[tauri::command]
fn get_unlocked_payload(state: State<'_, AppSecurityState>) -> Result<VaultPayload, String> {
    state_lock(&state)?
        .unlocked
        .as_ref()
        .map(|session| session.payload.clone())
        .ok_or_else(|| "Unlock the vault before reading its current state".to_string())
}

#[tauri::command]
fn save_vault_payload(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    payload: VaultPayload,
) -> Result<(), String> {
    let mut security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_mut()
        .ok_or_else(|| "Unlock the vault before saving".to_string())?;
    let envelope = encrypt_payload(&session.envelope, &session.data_key, &payload)?;
    write_envelope(&app, &envelope)?;
    session.envelope = envelope;
    session.payload = payload;
    Ok(())
}

#[tauri::command]
fn change_master_password(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    current_password: String,
    new_password: String,
) -> Result<(), String> {
    let current_password = Zeroizing::new(current_password);
    let new_password = Zeroizing::new(new_password);
    let mut security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_mut()
        .ok_or_else(|| "Unlock the vault before changing its password".to_string())?;
    let envelope = change_password(
        &session.envelope,
        &session.data_key,
        &current_password,
        &new_password,
    )?;
    write_envelope(&app, &envelope)?;
    session.envelope = envelope;
    Ok(())
}

#[tauri::command]
fn begin_totp_rebind(
    state: State<'_, AppSecurityState>,
    current_password: String,
) -> Result<TotpSetupView, String> {
    let current_password = Zeroizing::new(current_password);
    let mut security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_ref()
        .ok_or_else(|| "Unlock the vault before changing quick unlock".to_string())?;
    verify_password(&session.envelope, &session.data_key, &current_password)?;
    let (setup, view) = PendingTotpSetup::new()?;
    security.pending_rebind = Some(setup);
    Ok(view)
}

#[tauri::command]
fn confirm_totp_rebind(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    code: String,
) -> Result<(), String> {
    let mut security = state_lock(&state)?;
    let setup = security
        .pending_rebind
        .as_ref()
        .ok_or_else(|| "Authenticator setup has expired".to_string())?;
    setup.verify(&code)?;
    let session = security
        .unlocked
        .as_ref()
        .ok_or_else(|| "Unlock the vault before changing quick unlock".to_string())?;
    quick_unlock::save(
        &app,
        &session.envelope.vault_id,
        setup.secret(),
        &session.data_key,
    )?;
    security.pending_rebind = None;
    Ok(())
}

#[tauri::command]
fn disable_totp(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    current_password: String,
) -> Result<(), String> {
    let current_password = Zeroizing::new(current_password);
    let security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_ref()
        .ok_or_else(|| "Unlock the vault before changing quick unlock".to_string())?;
    verify_password(&session.envelope, &session.data_key, &current_password)?;
    quick_unlock::disable(&app)
}

#[tauri::command]
fn check_windows_hello() -> Result<windows_consent::HelloAvailability, String> {
    windows_consent::check_availability()
}

/// Identity is verified inside this command — never in a separate call — so the
/// vault cannot be wiped through any code path that skipped the OS gate.
#[tauri::command]
async fn reset_vault(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    runtime: State<'_, local_api::LocalApiRuntime>,
    acknowledgment: Option<String>,
) -> Result<ResetOutcome, String> {
    let verified_by = tauri::async_runtime::spawn_blocking(move || {
        verify_reset_consent(acknowledgment.as_deref())
    })
    .await
    .map_err(|_| "The reset task could not be started".to_string())??;

    // Snapshot the still-encrypted envelope first: if the backup fails, the
    // vault file must stay exactly as it was.
    let backup_path = backup_reset_snapshot(&app)?;

    let mut security = state_lock(&state)?;
    local_api::reset_security(&app, &runtime)?;
    storage::remove_if_exists(&vault_path(&app)?)?;
    quick_unlock::disable(&app)?;
    *security = SecurityState::default();
    Ok(ResetOutcome {
        backup_path,
        verified_by: verified_by.to_string(),
    })
}

fn verify_reset_consent(acknowledgment: Option<&str>) -> Result<&'static str, String> {
    match windows_consent::check_availability()? {
        windows_consent::HelloAvailability::Available => {
            if windows_consent::request_verification("验证 Windows 身份后才能重置 Github Auth")?
            {
                Ok("windowsHello")
            } else {
                Err("Windows 身份验证未通过，已取消重置".to_string())
            }
        }
        // No usable Windows Hello on this device: fall back to the typed phrase.
        _ => match acknowledgment {
            Some(phrase) if phrase.trim() == RESET_ACKNOWLEDGMENT_PHRASE => Ok("acknowledgment"),
            _ => Err(format!(
                "此电脑未配置 Windows Hello，请输入「{RESET_ACKNOWLEDGMENT_PHRASE}」确认后重试"
            )),
        },
    }
}

fn backup_reset_snapshot(app: &AppHandle) -> Result<String, String> {
    let contents = read_limited(&vault_path(app)?, MAX_VAULT_BYTES)?
        .ok_or_else(|| "本地没有可重置的保管库".to_string())?;
    let settings = backup::load_settings(app)?;
    let directory = match settings.validate() {
        Ok(directory) => directory,
        Err(_) => storage::default_backup_dir(app)?,
    };
    // v2 vaults ride the standard backup container; anything else (e.g. a legacy
    // v1 file) is copied verbatim so a reset can never destroy the only copy.
    let snapshot = match String::from_utf8(contents.clone())
        .map_err(|_| "本地保管库不是有效的文本".to_string())
        .and_then(|text| parse_v2(&text))
    {
        Ok(envelope) => backup::write_to_directory(&directory, &envelope, BackupKind::Reset)?,
        Err(_) => {
            let legacy = directory.join(format!(
                "github-auth-reset-{}-legacy.encrypted.json",
                Local::now().format("%Y%m%d-%H%M%S")
            ));
            storage::atomic_write(&legacy, &contents)?;
            legacy
        }
    };
    Ok(snapshot.to_string_lossy().into_owned())
}

#[tauri::command]
fn get_backup_settings(app: AppHandle) -> Result<BackupSettings, String> {
    backup::load_settings(&app)
}

#[tauri::command]
fn update_backup_settings(
    app: AppHandle,
    settings: BackupSettings,
) -> Result<BackupSettings, String> {
    backup::save_settings(&app, settings)
}

#[tauri::command]
fn choose_backup_directory(app: AppHandle) -> Result<Option<String>, String> {
    Ok(backup::select_backup_directory(&app)?.map(|path| path.to_string_lossy().into_owned()))
}

fn with_backup_extension(mut path: PathBuf) -> PathBuf {
    if path.extension().and_then(|extension| extension.to_str()) != Some("ghauth-backup") {
        path.set_extension("ghauth-backup");
    }
    path
}

#[tauri::command]
fn create_manual_backup(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
) -> Result<Option<String>, String> {
    let security = state_lock(&state)?;
    let session = security
        .unlocked
        .as_ref()
        .ok_or_else(|| "Unlock the vault before creating a manual backup".to_string())?;
    let Some(path) = backup::manual_backup_path(&app)? else {
        return Ok(None);
    };
    let path = with_backup_extension(path);
    backup::write_backup(&path, &session.envelope)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn choose_import_backup(app: AppHandle) -> Result<Option<String>, String> {
    Ok(backup::select_backup_file(&app)?.map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn inspect_backup(
    state: State<'_, AppSecurityState>,
    path: String,
    backup_password: String,
) -> Result<ImportPreview, String> {
    let backup_password = Zeroizing::new(backup_password);
    if path.len() > 32_768 {
        return Err("Backup path is invalid".to_string());
    }
    if state_lock(&state)?.unlocked.is_none() {
        return Err("Unlock the current vault before importing".to_string());
    }
    let (container, payload) = backup::read_backup(&PathBuf::from(path), &backup_password)?;
    let preview = ImportPreview {
        token: Uuid::new_v4().to_string(),
        account_count: payload.accounts.len(),
        group_count: payload.groups.len(),
        created_at: container.created_at.clone(),
    };
    let mut security = state_lock(&state)?;
    if security.unlocked.is_none() {
        return Err("Unlock the current vault before importing".to_string());
    }
    security.pending_import = Some(PendingImport {
        token: preview.token.clone(),
        payload,
        created_at: container.created_at,
    });
    Ok(preview)
}

#[tauri::command]
fn cancel_backup_import(state: State<'_, AppSecurityState>) -> Result<(), String> {
    state_lock(&state)?.pending_import = None;
    Ok(())
}

#[tauri::command]
fn commit_backup_import(
    app: AppHandle,
    state: State<'_, AppSecurityState>,
    token: String,
    mode: ImportMode,
    backup_current: bool,
    current_password: Option<String>,
) -> Result<VaultPayload, String> {
    let mut current_password = current_password.map(Zeroizing::new);
    let mut security = state_lock(&state)?;
    let (imported_payload, imported_created_at) = {
        let pending = security
            .pending_import
            .as_ref()
            .ok_or_else(|| "Backup import has expired".to_string())?;
        if pending.token != token {
            return Err("Backup import token is invalid".to_string());
        }
        (pending.payload.clone(), pending.created_at.clone())
    };
    let session = security
        .unlocked
        .as_mut()
        .ok_or_else(|| "Unlock the current vault before importing".to_string())?;

    if matches!(mode, ImportMode::Replace) {
        let password = current_password
            .as_ref()
            .ok_or_else(|| "Enter the current master password to replace data".to_string())?;
        verify_password(&session.envelope, &session.data_key, password)?;
        if backup_current {
            let settings = backup::load_settings(&app)?;
            let directory = settings.validate()?;
            backup::write_to_directory(&directory, &session.envelope, BackupKind::BeforeReplace)?;
        }
    }

    let date = DateTime::parse_from_rfc3339(&imported_created_at)
        .map(|date| date.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|_| Utc::now().format("%Y-%m-%d").to_string());
    let next_payload = backup::apply_import(&session.payload, &imported_payload, mode, &date)?;
    let next_envelope = encrypt_payload(&session.envelope, &session.data_key, &next_payload)?;
    write_envelope(&app, &next_envelope)?;
    session.envelope = next_envelope;
    session.payload = next_payload.clone();
    security.pending_import = None;
    if let Some(password) = current_password.as_mut() {
        password.zeroize();
    }
    Ok(next_payload)
}

fn start_backup_scheduler(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(60));
        let _ = backup::run_scheduled(&app);
    });
}

#[tauri::command]
fn set_screen_capture_protection(
    window: tauri::WebviewWindow,
    enabled: bool,
) -> Result<(), String> {
    window
        .set_content_protected(enabled)
        .map_err(|error| format!("Unable to update screen capture protection: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppSecurityState::default())
        .manage(local_api::LocalApiRuntime::default())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            start_backup_scheduler(app.handle().clone());
            local_api::start_server(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_vault_status,
            begin_initialization,
            cancel_initialization,
            begin_initial_totp_setup,
            complete_password_initialization,
            confirm_initial_totp,
            unlock_with_password,
            unlock_with_totp,
            verify_totp_for_action,
            verify_password_for_action,
            lock_vault,
            save_vault_payload,
            change_master_password,
            begin_totp_rebind,
            confirm_totp_rebind,
            disable_totp,
            check_windows_hello,
            reset_vault,
            get_backup_settings,
            update_backup_settings,
            choose_backup_directory,
            create_manual_backup,
            choose_import_backup,
            inspect_backup,
            cancel_backup_import,
            commit_backup_import,
            get_unlocked_payload,
            set_screen_capture_protection,
            local_api::get_local_api_runtime_status,
            local_api::export_local_api_connection,
            local_api::get_pending_api_pairings,
            local_api::get_pending_api_imports,
            local_api::get_pending_api_exports,
            local_api::approve_local_api_pairing,
            local_api::deny_local_api_pairing,
            local_api::approve_local_api_import,
            local_api::deny_local_api_import,
            local_api::approve_local_api_export,
            local_api::deny_local_api_export,
            local_api::create_local_api_key,
            local_api::set_local_api_export_enabled,
            local_api::set_local_api_key_enabled,
            local_api::delete_local_api_key,
            local_api::set_local_api_client_enabled,
            local_api::revoke_local_api_client,
            local_api::rotate_local_api_identity,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Github Auth");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn initialization_guard_rejects_an_existing_vault_file() {
        let directory =
            std::env::temp_dir().join(format!("github-auth-init-guard-{}", Uuid::new_v4()));
        let path = directory.join("vault.encrypted.json");

        assert!(ensure_vault_file_does_not_exist(&path).is_ok());
        fs::create_dir_all(&directory).unwrap();
        fs::write(&path, b"existing encrypted vault").unwrap();
        assert!(ensure_vault_file_does_not_exist(&path).is_err());

        fs::remove_dir_all(directory).unwrap();
    }
}
