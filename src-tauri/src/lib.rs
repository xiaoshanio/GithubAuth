mod backup;
mod quick_unlock;
mod storage;
mod vault;

use std::{path::PathBuf, sync::Mutex, thread, time::Duration};

use chrono::{DateTime, Utc};
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

fn state_lock<'a>(
    state: &'a State<'_, AppSecurityState>,
) -> Result<std::sync::MutexGuard<'a, SecurityState>, String> {
    state
        .0
        .lock()
        .map_err(|_| "Security state is unavailable".to_string())
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
fn lock_vault(state: State<'_, AppSecurityState>) -> Result<(), String> {
    let mut security = state_lock(&state)?;
    security.unlocked = None;
    security.pending_initialization = None;
    security.pending_import = None;
    security.pending_rebind = None;
    Ok(())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppSecurityState::default())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            start_backup_scheduler(app.handle().clone());
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
            lock_vault,
            save_vault_payload,
            change_master_password,
            begin_totp_rebind,
            confirm_totp_rebind,
            disable_totp,
            get_backup_settings,
            update_backup_settings,
            choose_backup_directory,
            create_manual_backup,
            choose_import_backup,
            inspect_backup,
            cancel_backup_import,
            commit_backup_import,
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
