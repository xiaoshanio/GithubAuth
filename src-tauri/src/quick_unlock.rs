use std::{
    ptr, slice,
    time::{SystemTime, UNIX_EPOCH},
};

use constant_time_eq::constant_time_eq;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use totp_rs::{Algorithm, TOTP};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::storage::{atomic_write, quick_unlock_path, read_limited, remove_if_exists};

const QUICK_UNLOCK_FORMAT: &str = "github-auth-quick-unlock";
const QUICK_UNLOCK_VERSION: u8 = 1;
const MAX_QUICK_UNLOCK_BYTES: usize = 64 * 1024;
const TOTP_STEP_SECONDS: u64 = 30;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TotpSetupView {
    pub qr_data_url: String,
    pub manual_secret: String,
}

pub struct PendingTotpSetup {
    secret: Zeroizing<Vec<u8>>,
}

#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct QuickUnlockBundle {
    format: String,
    version: u8,
    vault_id: String,
    secret: Vec<u8>,
    data_key: Vec<u8>,
    last_successful_step: Option<u64>,
    failed_attempts: u32,
    cooldown_until: i64,
}

pub struct QuickUnlockResult {
    pub data_key: Zeroizing<Vec<u8>>,
}

impl PendingTotpSetup {
    pub fn new() -> Result<(Self, TotpSetupView), String> {
        let mut secret = Zeroizing::new(vec![0_u8; 20]);
        rand::RngCore::fill_bytes(&mut rand::rngs::OsRng, &mut secret);
        let totp = make_totp(&secret)?;
        let qr = totp
            .get_qr_base64()
            .map_err(|_| "Unable to generate the authenticator QR code".to_string())?;
        let view = TotpSetupView {
            qr_data_url: format!("data:image/png;base64,{qr}"),
            manual_secret: totp.get_secret_base32(),
        };
        Ok((Self { secret }, view))
    }

    pub fn verify(&self, code: &str) -> Result<(), String> {
        verify_code_at(&self.secret, code, unix_time()?)
    }

    pub fn secret(&self) -> &[u8] {
        &self.secret
    }
}

fn make_totp(secret: &[u8]) -> Result<TOTP, String> {
    TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        TOTP_STEP_SECONDS,
        secret.to_vec(),
        Some("Github Auth".to_string()),
        "Vault".to_string(),
    )
    .map_err(|_| "Unable to initialize the authenticator secret".to_string())
}

fn unix_time() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|_| "System time is invalid; use the master password instead".to_string())
}

fn verify_code_at(secret: &[u8], code: &str, time: u64) -> Result<(), String> {
    verified_step_at(secret, code, time).map(|_| ())
}

fn verified_step_at(secret: &[u8], code: &str, time: u64) -> Result<u64, String> {
    if code.len() != 6 || !code.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("Enter a valid 6-digit authenticator code".to_string());
    }
    let totp = make_totp(secret)?;
    let current_step = time / totp.step;
    let first_step = current_step.saturating_sub(u64::from(totp.skew));
    let last_step = current_step.saturating_add(u64::from(totp.skew));
    for step in first_step..=last_step {
        let candidate = totp.generate(step.saturating_mul(totp.step));
        if constant_time_eq(candidate.as_bytes(), code.as_bytes()) {
            return Ok(step);
        }
    }
    Err("The authenticator code is incorrect".to_string())
}

pub fn save(app: &AppHandle, vault_id: &str, secret: &[u8], data_key: &[u8]) -> Result<(), String> {
    if secret.len() < 16 || data_key.len() != 32 {
        return Err("Quick unlock material is invalid".to_string());
    }
    let bundle = QuickUnlockBundle {
        format: QUICK_UNLOCK_FORMAT.to_string(),
        version: QUICK_UNLOCK_VERSION,
        vault_id: vault_id.to_string(),
        secret: secret.to_vec(),
        data_key: data_key.to_vec(),
        last_successful_step: None,
        failed_attempts: 0,
        cooldown_until: 0,
    };
    write_bundle(app, &bundle)
}

pub fn is_enabled(app: &AppHandle, vault_id: Option<&str>) -> bool {
    let Some(expected_vault_id) = vault_id else {
        return false;
    };
    read_bundle(app)
        .map(|bundle| bundle.vault_id == expected_vault_id)
        .unwrap_or(false)
}

pub fn disable(app: &AppHandle) -> Result<(), String> {
    remove_if_exists(&quick_unlock_path(app)?)
}

pub fn verify(app: &AppHandle, vault_id: &str, code: &str) -> Result<QuickUnlockResult, String> {
    let mut bundle = read_bundle(app)?;
    if bundle.vault_id != vault_id {
        return Err(
            "Quick unlock does not belong to this vault; use the master password".to_string(),
        );
    }
    let now = unix_time()?;
    if bundle.cooldown_until > now as i64 {
        return Err(format!(
            "Too many failed attempts. Try again in {} seconds or use the master password",
            bundle.cooldown_until - now as i64
        ));
    }

    let verified_step = match verified_step_at(&bundle.secret, code, now) {
        Ok(step) => step,
        Err(error) => {
            bundle.failed_attempts = bundle.failed_attempts.saturating_add(1);
            if bundle.failed_attempts >= 5 {
                let exponent = (bundle.failed_attempts - 5).min(5);
                let cooldown = (30_i64 * 2_i64.pow(exponent)).min(900);
                bundle.cooldown_until = now as i64 + cooldown;
            }
            write_bundle(app, &bundle)?;
            return Err(error);
        }
    };

    if bundle.last_successful_step == Some(verified_step) {
        return Err("This authenticator code was already used; wait for the next code".to_string());
    }
    bundle.last_successful_step = Some(verified_step);
    bundle.failed_attempts = 0;
    bundle.cooldown_until = 0;
    let data_key = Zeroizing::new(bundle.data_key.clone());
    write_bundle(app, &bundle)?;
    bundle.secret.zeroize();
    bundle.data_key.zeroize();
    Ok(QuickUnlockResult { data_key })
}

fn read_bundle(app: &AppHandle) -> Result<QuickUnlockBundle, String> {
    let path = quick_unlock_path(app)?;
    let protected = read_limited(&path, MAX_QUICK_UNLOCK_BYTES)?
        .ok_or_else(|| "Quick unlock is not configured; use the master password".to_string())?;
    let plaintext = Zeroizing::new(unprotect(&protected)?);
    let bundle = serde_json::from_slice::<QuickUnlockBundle>(&plaintext)
        .map_err(|_| "Quick unlock data is damaged; use the master password".to_string())?;
    if bundle.format != QUICK_UNLOCK_FORMAT
        || bundle.version != QUICK_UNLOCK_VERSION
        || bundle.secret.len() < 16
        || bundle.data_key.len() != 32
    {
        return Err("Quick unlock data is invalid; use the master password".to_string());
    }
    Ok(bundle)
}

fn write_bundle(app: &AppHandle, bundle: &QuickUnlockBundle) -> Result<(), String> {
    let serialized = Zeroizing::new(
        serde_json::to_vec(bundle)
            .map_err(|_| "Unable to serialize quick unlock data".to_string())?,
    );
    let protected = Zeroizing::new(protect(&serialized)?);
    atomic_write(&quick_unlock_path(app)?, &protected)
}

#[cfg(windows)]
fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB},
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(data.len())
            .map_err(|_| "Quick unlock data is too large".to_string())?,
        pbData: data.as_ptr() as *mut u8,
    };
    let entropy_bytes = b"com.githubauth.vault:quick-unlock:v1";
    let entropy = CRYPT_INTEGER_BLOB {
        cbData: entropy_bytes.len() as u32,
        pbData: entropy_bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };
    let success = unsafe {
        CryptProtectData(
            &input,
            ptr::null(),
            &entropy,
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if success == 0 {
        return Err(format!(
            "Windows could not protect quick unlock data: {}",
            std::io::Error::last_os_error()
        ));
    }
    let result = unsafe { slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe { LocalFree(output.pbData.cast()) };
    Ok(result)
}

#[cfg(windows)]
fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };

    let input = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(data.len())
            .map_err(|_| "Quick unlock data is too large".to_string())?,
        pbData: data.as_ptr() as *mut u8,
    };
    let entropy_bytes = b"com.githubauth.vault:quick-unlock:v1";
    let entropy = CRYPT_INTEGER_BLOB {
        cbData: entropy_bytes.len() as u32,
        pbData: entropy_bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };
    let success = unsafe {
        CryptUnprotectData(
            &input,
            ptr::null_mut(),
            &entropy,
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if success == 0 {
        return Err(
            "Quick unlock is unavailable for this Windows user; use the master password"
                .to_string(),
        );
    }
    let result = unsafe { slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe { LocalFree(output.pbData.cast()) };
    Ok(result)
}

#[cfg(not(windows))]
fn protect(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("Quick unlock is only available on Windows".to_string())
}

#[cfg(not(windows))]
fn unprotect(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("Quick unlock is only available on Windows".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_rfc_totp_and_rejects_invalid_codes() {
        let secret = b"12345678901234567890";
        let totp = make_totp(secret).unwrap();
        let time = 1_700_000_000;
        let code = totp.generate(time);
        assert!(verify_code_at(secret, &code, time).is_ok());
        assert!(verify_code_at(secret, "000000", time).is_err());
        assert!(verify_code_at(secret, "12ab56", time).is_err());
    }

    #[test]
    fn records_the_step_that_generated_a_code_across_the_skew_window() {
        let secret = b"12345678901234567890";
        let generated_at = 1_700_000_010;
        let code = make_totp(secret).unwrap().generate(generated_at);

        assert_eq!(
            verified_step_at(secret, &code, generated_at + TOTP_STEP_SECONDS).unwrap(),
            generated_at / TOTP_STEP_SECONDS
        );
    }

    #[cfg(windows)]
    #[test]
    fn windows_dpapi_round_trips_and_authenticates_quick_unlock_material() {
        let plaintext = b"vault-id, totp secret, and a 32-byte data key";
        let protected = protect(plaintext).unwrap();
        assert_ne!(protected, plaintext);
        assert_eq!(unprotect(&protected).unwrap(), plaintext);

        let last = protected.len() - 1;
        let mut tampered = protected;
        tampered[last] ^= 1;
        assert!(unprotect(&tampered).is_err());
    }
}
