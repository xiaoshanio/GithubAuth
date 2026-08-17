use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

use chrono::{DateTime, Duration, Local, Utc};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use uuid::Uuid;

use crate::{
    storage::{atomic_write, backup_settings_path, default_backup_dir, read_limited, vault_path},
    vault::{
        parse_v2, serialize_v2, unlock_v2, VaultEnvelopeV2, VaultGroup, VaultPayload,
        MAX_VAULT_BYTES,
    },
};

const BACKUP_FORMAT: &str = "github-auth-backup";
const BACKUP_VERSION: u8 = 1;
const MAX_BACKUP_BYTES: usize = MAX_VAULT_BYTES + 64 * 1024;
const AUTOMATIC_PREFIX: &str = "github-auth-auto-";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BackupSettings {
    pub enabled: bool,
    pub interval_hours: u32,
    pub directory: String,
    pub retention: u32,
    pub last_backup_at: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BackupContainer {
    pub format: String,
    pub version: u8,
    pub created_at: String,
    pub app_version: String,
    pub vault: VaultEnvelopeV2,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportMode {
    Add,
    Replace,
    BackupGroup,
}

#[derive(Clone, Copy)]
pub enum BackupKind {
    Automatic,
    Manual,
    BeforeReplace,
}

impl BackupSettings {
    pub fn defaults(app: &AppHandle) -> Result<Self, String> {
        Ok(Self {
            enabled: false,
            interval_hours: 24,
            directory: default_backup_dir(app)?.to_string_lossy().into_owned(),
            retention: 10,
            last_backup_at: None,
            last_error: None,
        })
    }

    pub fn validate(&self) -> Result<PathBuf, String> {
        if !matches!(self.interval_hours, 6 | 12 | 24 | 168) {
            return Err("Backup frequency is unsupported".to_string());
        }
        if !(1..=100).contains(&self.retention) {
            return Err("Backup retention must be between 1 and 100".to_string());
        }
        if self.directory.trim().is_empty() || self.directory.len() > 32_768 {
            return Err("Backup directory is invalid".to_string());
        }
        Ok(PathBuf::from(&self.directory))
    }
}

pub fn load_settings(app: &AppHandle) -> Result<BackupSettings, String> {
    let path = backup_settings_path(app)?;
    let Some(contents) = read_limited(&path, 64 * 1024)? else {
        return BackupSettings::defaults(app);
    };
    let settings = serde_json::from_slice::<BackupSettings>(&contents)
        .map_err(|_| "Backup settings are invalid".to_string())?;
    settings.validate()?;
    Ok(settings)
}

pub fn save_settings(
    app: &AppHandle,
    mut settings: BackupSettings,
) -> Result<BackupSettings, String> {
    let directory = settings.validate()?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Unable to create the backup directory: {error}"))?;
    if !directory.is_dir() {
        return Err("Backup destination is not a directory".to_string());
    }
    settings.directory = directory.to_string_lossy().into_owned();
    let serialized = serde_json::to_vec(&settings)
        .map_err(|_| "Unable to serialize backup settings".to_string())?;
    atomic_write(&backup_settings_path(app)?, &serialized)?;
    Ok(settings)
}

fn container(envelope: VaultEnvelopeV2) -> BackupContainer {
    BackupContainer {
        format: BACKUP_FORMAT.to_string(),
        version: BACKUP_VERSION,
        created_at: Utc::now().to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        vault: envelope,
    }
}

fn parse_container(contents: &[u8]) -> Result<BackupContainer, String> {
    if contents.len() > MAX_BACKUP_BYTES {
        return Err("Backup file is larger than the allowed limit".to_string());
    }
    let backup = serde_json::from_slice::<BackupContainer>(contents)
        .map_err(|_| "Backup file has an invalid format".to_string())?;
    if backup.format != BACKUP_FORMAT
        || backup.version != BACKUP_VERSION
        || backup.app_version.is_empty()
        || DateTime::parse_from_rfc3339(&backup.created_at).is_err()
    {
        return Err("Backup file is incomplete or unsupported".to_string());
    }
    let serialized_vault = serialize_v2(&backup.vault)?;
    parse_v2(&serialized_vault)?;
    Ok(backup)
}

pub fn read_backup(path: &Path, password: &str) -> Result<(BackupContainer, VaultPayload), String> {
    let contents = read_limited(path, MAX_BACKUP_BYTES)?
        .ok_or_else(|| "Backup file no longer exists".to_string())?;
    let backup = parse_container(&contents)?;
    let unlocked = unlock_v2(backup.vault.clone(), password)
        .map_err(|_| "The backup password is incorrect or the file is damaged".to_string())?;
    Ok((backup, unlocked.payload))
}

fn file_stamp() -> String {
    Local::now().format("%Y%m%d-%H%M%S").to_string()
}

fn file_name(kind: BackupKind) -> String {
    let prefix = match kind {
        BackupKind::Automatic => AUTOMATIC_PREFIX,
        BackupKind::Manual => "github-auth-",
        BackupKind::BeforeReplace => "github-auth-before-replace-",
    };
    format!("{prefix}{}.ghauth-backup", file_stamp())
}

pub fn write_backup(path: &Path, envelope: &VaultEnvelopeV2) -> Result<PathBuf, String> {
    let serialized = serde_json::to_vec(&container(envelope.clone()))
        .map_err(|_| "Unable to serialize the backup".to_string())?;
    if serialized.len() > MAX_BACKUP_BYTES {
        return Err("Backup file is larger than the allowed limit".to_string());
    }
    atomic_write(path, &serialized)?;
    let written = read_limited(path, MAX_BACKUP_BYTES)?
        .ok_or_else(|| "Backup file was not written".to_string())?;
    parse_container(&written)?;
    if written != serialized {
        return Err("Backup verification failed after writing".to_string());
    }
    Ok(path.to_path_buf())
}

pub fn write_to_directory(
    directory: &Path,
    envelope: &VaultEnvelopeV2,
    kind: BackupKind,
) -> Result<PathBuf, String> {
    fs::create_dir_all(directory)
        .map_err(|error| format!("Unable to create the backup directory: {error}"))?;
    write_backup(&directory.join(file_name(kind)), envelope)
}

pub fn load_current_envelope(app: &AppHandle) -> Result<VaultEnvelopeV2, String> {
    let path = vault_path(app)?;
    let contents = read_limited(&path, MAX_VAULT_BYTES)?
        .ok_or_else(|| "The encrypted vault does not exist".to_string())?;
    let text = String::from_utf8(contents)
        .map_err(|_| "The encrypted vault is not valid UTF-8".to_string())?;
    parse_v2(&text)
}

pub fn manual_backup_path(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let settings = load_settings(app)?;
    let directory = settings.validate()?;
    Ok(rfd::FileDialog::new()
        .set_title("Save encrypted Github Auth backup")
        .set_directory(directory)
        .set_file_name(file_name(BackupKind::Manual))
        .add_filter("Github Auth backup", &["ghauth-backup"])
        .save_file())
}

pub fn select_backup_file(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let settings = load_settings(app)?;
    let directory = settings.validate()?;
    Ok(rfd::FileDialog::new()
        .set_title("Open encrypted Github Auth backup")
        .set_directory(directory)
        .add_filter("Github Auth backup", &["ghauth-backup"])
        .pick_file())
}

pub fn select_backup_directory(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let settings = load_settings(app)?;
    let directory = settings.validate()?;
    Ok(rfd::FileDialog::new()
        .set_title("Choose automatic backup folder")
        .set_directory(directory)
        .pick_folder())
}

pub fn is_due(settings: &BackupSettings, now: DateTime<Utc>) -> bool {
    if !settings.enabled {
        return false;
    }
    let Some(last) = settings
        .last_backup_at
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc))
    else {
        return true;
    };
    now >= last + Duration::hours(settings.interval_hours as i64)
}

pub fn run_scheduled(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let mut settings = load_settings(app)?;
    if !is_due(&settings, Utc::now()) {
        return Ok(None);
    }
    let result: Result<PathBuf, String> = (|| {
        let envelope = load_current_envelope(app)?;
        let directory = settings.validate()?;
        let path = write_to_directory(&directory, &envelope, BackupKind::Automatic)?;
        rotate_automatic(&directory, settings.retention)?;
        Ok(path)
    })();

    match result {
        Ok(path) => {
            settings.last_backup_at = Some(Utc::now().to_rfc3339());
            settings.last_error = None;
            save_settings(app, settings)?;
            Ok(Some(path))
        }
        Err(error) => {
            settings.last_error = Some(error.clone());
            let _ = save_settings(app, settings);
            Err(error)
        }
    }
}

fn rotate_automatic(directory: &Path, retention: u32) -> Result<(), String> {
    let mut files = fs::read_dir(directory)
        .map_err(|error| format!("Unable to inspect the backup directory: {error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| {
                    name.starts_with(AUTOMATIC_PREFIX) && name.ends_with(".ghauth-backup")
                })
        })
        .collect::<Vec<_>>();
    files.sort();
    let remove_count = files.len().saturating_sub(retention as usize);
    for path in files.into_iter().take(remove_count) {
        fs::remove_file(&path)
            .map_err(|error| format!("Unable to remove old backup {}: {error}", path.display()))?;
    }
    Ok(())
}

pub fn apply_import(
    current: &VaultPayload,
    imported: &VaultPayload,
    mode: ImportMode,
    import_date: &str,
) -> Result<VaultPayload, String> {
    match mode {
        ImportMode::Replace => Ok(imported.clone()),
        ImportMode::Add => add_payload(current, imported),
        ImportMode::BackupGroup => backup_group_payload(current, imported, import_date),
    }
}

fn unique_group_name(existing: &HashSet<String>, requested: &str) -> String {
    if !existing.contains(requested) {
        return requested.to_string();
    }
    let imported = format!("{requested}（导入）");
    if !existing.contains(&imported) {
        return imported;
    }
    for number in 2..=10_000 {
        let candidate = format!("{requested}（导入 {number}）");
        if !existing.contains(&candidate) {
            return candidate;
        }
    }
    format!("{requested}（{}）", Uuid::new_v4())
}

fn add_payload(current: &VaultPayload, imported: &VaultPayload) -> Result<VaultPayload, String> {
    let mut next = current.clone();
    let mut names = next
        .groups
        .iter()
        .map(|group| group.name.clone())
        .collect::<HashSet<_>>();
    let mut group_map = HashMap::new();
    for group in &imported.groups {
        let new_id = Uuid::new_v4().to_string();
        let name = unique_group_name(&names, &group.name);
        names.insert(name.clone());
        group_map.insert(group.id.clone(), new_id.clone());
        next.groups.push(VaultGroup {
            id: new_id,
            name,
            color: group.color.clone(),
            created_at: group.created_at.clone(),
        });
    }
    for account in &imported.accounts {
        let mut account = account.clone();
        account.id = Uuid::new_v4().to_string();
        account.group_id = group_map
            .get(&account.group_id)
            .cloned()
            .unwrap_or_default();
        next.accounts.push(account);
    }
    crate::vault::validate_payload(&next)?;
    Ok(next)
}

fn backup_group_payload(
    current: &VaultPayload,
    imported: &VaultPayload,
    import_date: &str,
) -> Result<VaultPayload, String> {
    let mut next = current.clone();
    let names = next
        .groups
        .iter()
        .map(|group| group.name.clone())
        .collect::<HashSet<_>>();
    let requested = format!("备份导入 · {import_date}");
    let group = VaultGroup {
        id: Uuid::new_v4().to_string(),
        name: unique_group_name(&names, &requested),
        color: "#A855F7".to_string(),
        created_at: Utc::now().to_rfc3339(),
    };
    for account in &imported.accounts {
        let mut account = account.clone();
        account.id = Uuid::new_v4().to_string();
        account.group_id = group.id.clone();
        next.accounts.push(account);
    }
    next.groups.push(group);
    crate::vault::validate_payload(&next)?;
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::{create_vault, VaultAccount, VaultSettings};

    fn payload(prefix: &str) -> VaultPayload {
        VaultPayload {
            groups: vec![VaultGroup {
                id: format!("{prefix}-group"),
                name: "Team".to_string(),
                color: "#A855F7".to_string(),
                created_at: "2026-08-15T00:00:00Z".to_string(),
            }],
            accounts: vec![VaultAccount {
                id: format!("{prefix}-account"),
                name: format!("{prefix}-user"),
                email: String::new(),
                password: "password".to_string(),
                totp_secret: String::new(),
                group_id: format!("{prefix}-group"),
                avatar_url: None,
                github_created_at: None,
                created_at: "2026-08-15T00:00:00Z".to_string(),
                updated_at: "2026-08-15T00:00:00Z".to_string(),
            }],
            settings: VaultSettings::default(),
        }
    }

    #[test]
    fn backup_container_round_trips_with_its_original_password() {
        let created = create_vault("correct horse battery staple", payload("backup")).unwrap();
        let serialized = serde_json::to_vec(&container(created.envelope.clone())).unwrap();
        let parsed = parse_container(&serialized).unwrap();
        assert!(unlock_v2(parsed.vault.clone(), "wrong backup password").is_err());
        assert_eq!(
            unlock_v2(parsed.vault, "correct horse battery staple")
                .unwrap()
                .payload,
            payload("backup")
        );
    }

    #[test]
    fn rejects_a_backup_with_an_invalid_creation_time() {
        let created = create_vault("correct horse battery staple", payload("backup")).unwrap();
        let mut value = serde_json::to_value(container(created.envelope)).unwrap();
        value["createdAt"] = serde_json::Value::String("not-a-timestamp".to_string());

        assert!(parse_container(&serde_json::to_vec(&value).unwrap()).is_err());
    }

    #[test]
    fn add_mode_remaps_ids_and_preserves_current_settings() {
        let mut current = payload("current");
        current.settings.language = "en".to_string();
        let imported = payload("imported");
        let next = apply_import(&current, &imported, ImportMode::Add, "2026-08-15").unwrap();
        assert_eq!(next.accounts.len(), 2);
        assert_eq!(next.groups.len(), 2);
        assert_eq!(next.settings.language, "en");
        assert_ne!(next.accounts[1].id, imported.accounts[0].id);
        assert_ne!(next.groups[1].id, imported.groups[0].id);
        assert_eq!(next.groups[1].name, "Team（导入）");
        assert_eq!(next.accounts[1].group_id, next.groups[1].id);
    }

    #[test]
    fn backup_group_mode_flattens_imported_accounts() {
        let current = payload("current");
        let imported = payload("imported");
        let next =
            apply_import(&current, &imported, ImportMode::BackupGroup, "2026-08-15").unwrap();
        assert_eq!(next.groups.len(), 2);
        assert_eq!(next.groups[1].name, "备份导入 · 2026-08-15");
        assert_eq!(next.accounts[1].group_id, next.groups[1].id);
        assert_eq!(next.settings, current.settings);
    }

    #[test]
    fn replace_reencrypts_imported_data_with_the_current_vault_password() {
        let current_password = "current client master password";
        let backup_password = "different backup master password";
        let current = create_vault(current_password, payload("current")).unwrap();
        let backup = create_vault(backup_password, payload("imported")).unwrap();
        let serialized_backup = serde_json::to_vec(&container(backup.envelope)).unwrap();
        let parsed_backup = parse_container(&serialized_backup).unwrap();
        assert!(unlock_v2(parsed_backup.vault.clone(), current_password).is_err());
        let imported = unlock_v2(parsed_backup.vault, backup_password)
            .unwrap()
            .payload;

        let replacement = apply_import(
            &current.payload,
            &imported,
            ImportMode::Replace,
            "2026-08-15",
        )
        .unwrap();
        let envelope =
            crate::vault::encrypt_payload(&current.envelope, &current.data_key, &replacement)
                .unwrap();

        assert_eq!(
            unlock_v2(envelope.clone(), current_password)
                .unwrap()
                .payload,
            payload("imported")
        );
        assert!(unlock_v2(envelope, backup_password).is_err());
    }

    #[test]
    fn before_replace_backup_keeps_the_current_vault_password() {
        let directory =
            std::env::temp_dir().join(format!("github-auth-before-replace-{}", Uuid::new_v4()));
        let current_password = "current client master password";
        let current = create_vault(current_password, payload("current")).unwrap();

        let path =
            write_to_directory(&directory, &current.envelope, BackupKind::BeforeReplace).unwrap();
        assert_eq!(
            read_backup(&path, current_password).unwrap().1,
            payload("current")
        );
        assert!(read_backup(&path, "different backup master password").is_err());

        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn schedule_respects_enabled_frequency() {
        let now = Utc::now();
        let mut settings = BackupSettings {
            enabled: true,
            interval_hours: 24,
            directory: "backups".to_string(),
            retention: 10,
            last_backup_at: None,
            last_error: None,
        };
        assert!(is_due(&settings, now));
        settings.last_backup_at = Some((now - Duration::hours(23)).to_rfc3339());
        assert!(!is_due(&settings, now));
        settings.last_backup_at = Some((now - Duration::hours(25)).to_rfc3339());
        assert!(is_due(&settings, now));
    }
}
