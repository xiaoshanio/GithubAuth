use std::{
    fs,
    io::{ErrorKind, Read, Write},
    path::{Path, PathBuf},
};

use tauri::{AppHandle, Manager};
use uuid::Uuid;

pub const VAULT_FILE: &str = "vault.encrypted.json";
pub const QUICK_UNLOCK_FILE: &str = "quick-unlock.dpapi";
pub const BACKUP_SETTINGS_FILE: &str = "backup-settings.json";

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))
}

pub fn vault_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(VAULT_FILE))
}

pub fn quick_unlock_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(QUICK_UNLOCK_FILE))
}

pub fn backup_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(BACKUP_SETTINGS_FILE))
}

pub fn default_backup_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("backups"))
}

pub fn read_limited(path: &Path, maximum: usize) -> Result<Option<Vec<u8>>, String> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Unable to inspect {}: {error}", path.display())),
    };
    if metadata.len() > maximum as u64 {
        return Err(format!(
            "{} is larger than the allowed limit",
            path.display()
        ));
    }
    let file = fs::File::open(path)
        .map_err(|error| format!("Unable to open {}: {error}", path.display()))?;
    let mut contents = Vec::with_capacity(metadata.len() as usize);
    file.take((maximum as u64).saturating_add(1))
        .read_to_end(&mut contents)
        .map_err(|error| format!("Unable to read {}: {error}", path.display()))?;
    if contents.len() > maximum {
        return Err(format!(
            "{} is larger than the allowed limit",
            path.display()
        ));
    }
    Ok(Some(contents))
}

pub fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let directory = path
        .parent()
        .ok_or_else(|| "Unable to resolve the destination directory".to_string())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("Unable to create {}: {error}", directory.display()))?;

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Destination file name is invalid".to_string())?;
    let temporary_path = directory.join(format!(".{file_name}.{}.tmp", Uuid::new_v4()));

    let write_result = (|| {
        let mut temporary_file = fs::File::create(&temporary_path)
            .map_err(|error| format!("Unable to write {}: {error}", temporary_path.display()))?;
        temporary_file
            .write_all(contents)
            .and_then(|_| temporary_file.sync_all())
            .map_err(|error| format!("Unable to flush {}: {error}", temporary_path.display()))?;
        replace_file(&temporary_path, path)?;
        Ok(())
    })();

    if temporary_path.exists() {
        let _ = fs::remove_file(temporary_path);
    }
    write_result
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let success = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if success == 0 {
        return Err(format!(
            "Unable to atomically replace the destination: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(source, destination)
        .map_err(|error| format!("Unable to finalize {}: {error}", destination.display()))
}

pub fn remove_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Unable to remove {}: {error}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_complete_contents() {
        let directory =
            std::env::temp_dir().join(format!("github-auth-storage-{}", Uuid::new_v4()));
        let path = directory.join("vault.test");
        atomic_write(&path, b"first").unwrap();
        atomic_write(&path, b"second").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"second");
        fs::remove_dir_all(directory).unwrap();
    }
}
