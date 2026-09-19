use std::{ptr, slice};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::{Duration, Utc};
use rand::{rngs::OsRng, RngCore};
use rcgen::{
    BasicConstraints, CertificateParams, CertificateSigningRequestParams, DistinguishedName,
    DnType, ExtendedKeyUsagePurpose, IsCa, Issuer, KeyPair, KeyUsagePurpose, PublicKeyData,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use time::OffsetDateTime;
use uuid::Uuid;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::storage::{app_data_dir, atomic_write, read_limited, remove_if_exists};

const IDENTITY_FILE: &str = "local-api-identity.dpapi";
const MAX_IDENTITY_BYTES: usize = 512 * 1024;
const IDENTITY_FORMAT: &str = "github-auth-local-api-identity";
const IDENTITY_VERSION: u8 = 1;
const CLIENT_CERT_DAYS: i64 = 90;

#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct StoredIdentity {
    format: String,
    version: u8,
    instance_id: String,
    ca_key_der: Vec<u8>,
    ca_cert_der: Vec<u8>,
    server_key_der: Vec<u8>,
    server_cert_der: Vec<u8>,
    encryption_secret: Vec<u8>,
    created_at: String,
}

pub struct LocalIdentity {
    stored: StoredIdentity,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    pub version: u8,
    pub address: String,
    pub instance_id: String,
    pub server_spki_sha256: String,
    pub server_x25519_public_key: String,
    pub ca_certificate_pem: String,
}

pub struct SignedClientCertificate {
    pub certificate_pem: String,
    pub fingerprint: String,
    pub expires_at: String,
}

impl LocalIdentity {
    pub fn load_or_create(app: &AppHandle) -> Result<Self, String> {
        let path = app_data_dir(app)?.join(IDENTITY_FILE);
        let stored = match read_limited(&path, MAX_IDENTITY_BYTES)? {
            Some(protected) => {
                let plaintext = Zeroizing::new(unprotect(&protected)?);
                serde_json::from_slice::<StoredIdentity>(&plaintext)
                    .map_err(|_| "The local API identity is damaged".to_string())?
            }
            None => {
                let stored = Self::generate()?;
                Self::save(app, &stored)?;
                stored
            }
        };
        Self::validate(&stored)?;
        restrict_identity_permissions(&path)?;
        Ok(Self { stored })
    }

    fn generate() -> Result<StoredIdentity, String> {
        let instance_id = Uuid::new_v4().to_string();
        let ca_key = KeyPair::generate().map_err(|_| "Unable to generate the local CA key")?;
        let root_params = ca_params(&instance_id);
        let ca_cert = root_params
            .self_signed(&ca_key)
            .map_err(|_| "Unable to create the local CA certificate")?;

        let server_key = KeyPair::generate().map_err(|_| "Unable to generate the TLS key")?;
        let mut server_params =
            CertificateParams::new(vec!["localhost".to_string(), "127.0.0.1".to_string()])
                .map_err(|_| "Unable to prepare the TLS certificate")?;
        server_params.distinguished_name =
            distinguished_name("Github Auth Local API", &format!("instance {instance_id}"));
        server_params.not_before = OffsetDateTime::now_utc() - time::Duration::minutes(5);
        server_params.not_after = OffsetDateTime::now_utc() + time::Duration::days(825);
        server_params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
        server_params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
        let issuer = Issuer::new(ca_params(&instance_id), &ca_key);
        let server_cert = server_params
            .signed_by(&server_key, &issuer)
            .map_err(|_| "Unable to sign the TLS certificate")?;

        let mut encryption_secret = vec![0_u8; 32];
        OsRng.fill_bytes(&mut encryption_secret);
        Ok(StoredIdentity {
            format: IDENTITY_FORMAT.to_string(),
            version: IDENTITY_VERSION,
            instance_id,
            ca_key_der: ca_key.serialize_der(),
            ca_cert_der: ca_cert.der().to_vec(),
            server_key_der: server_key.serialize_der(),
            server_cert_der: server_cert.der().to_vec(),
            encryption_secret,
            created_at: Utc::now().to_rfc3339(),
        })
    }

    fn validate(stored: &StoredIdentity) -> Result<(), String> {
        if stored.format != IDENTITY_FORMAT
            || stored.version != IDENTITY_VERSION
            || Uuid::parse_str(&stored.instance_id).is_err()
            || stored.encryption_secret.len() != 32
            || stored.ca_cert_der.is_empty()
            || stored.server_cert_der.is_empty()
        {
            return Err("The local API identity is invalid".to_string());
        }
        KeyPair::try_from(stored.ca_key_der.as_slice())
            .map_err(|_| "The local CA key is invalid".to_string())?;
        KeyPair::try_from(stored.server_key_der.as_slice())
            .map_err(|_| "The local TLS key is invalid".to_string())?;
        Ok(())
    }

    fn save(app: &AppHandle, stored: &StoredIdentity) -> Result<(), String> {
        let serialized = Zeroizing::new(
            serde_json::to_vec(stored)
                .map_err(|_| "Unable to serialize the local API identity".to_string())?,
        );
        let protected = Zeroizing::new(protect(&serialized)?);
        let path = app_data_dir(app)?.join(IDENTITY_FILE);
        atomic_write(&path, &protected)?;
        restrict_identity_permissions(&path)
    }

    pub fn reset(app: &AppHandle) -> Result<(), String> {
        remove_if_exists(&app_data_dir(app)?.join(IDENTITY_FILE))
    }

    pub fn instance_id(&self) -> &str {
        &self.stored.instance_id
    }

    pub fn ca_cert_der(&self) -> &[u8] {
        &self.stored.ca_cert_der
    }

    pub fn server_cert_der(&self) -> &[u8] {
        &self.stored.server_cert_der
    }

    pub fn server_key_der(&self) -> &[u8] {
        &self.stored.server_key_der
    }

    pub fn encryption_secret(&self) -> Result<[u8; 32], String> {
        self.stored
            .encryption_secret
            .as_slice()
            .try_into()
            .map_err(|_| "The local encryption key is invalid".to_string())
    }

    pub fn encryption_public_key(&self) -> Result<String, String> {
        let secret = x25519_dalek::StaticSecret::from(self.encryption_secret()?);
        Ok(STANDARD.encode(x25519_dalek::PublicKey::from(&secret).as_bytes()))
    }

    pub fn spki_fingerprint(&self) -> Result<String, String> {
        let key = KeyPair::try_from(self.stored.server_key_der.as_slice())
            .map_err(|_| "The local TLS key is invalid".to_string())?;
        Ok(format!(
            "sha256/{}",
            STANDARD.encode(Sha256::digest(key.subject_public_key_info()))
        ))
    }

    pub fn connection_config(&self) -> Result<ConnectionConfig, String> {
        Ok(ConnectionConfig {
            version: 2,
            address: "https://127.0.0.1:46329/v2".to_string(),
            instance_id: self.instance_id().to_string(),
            server_spki_sha256: self.spki_fingerprint()?,
            server_x25519_public_key: self.encryption_public_key()?,
            ca_certificate_pem: pem_certificate(self.ca_cert_der()),
        })
    }

    pub fn sign_client_csr(&self, csr_pem: &str) -> Result<SignedClientCertificate, String> {
        if csr_pem.len() > 64 * 1024 {
            return Err("The client CSR is too large".to_string());
        }
        let mut csr = CertificateSigningRequestParams::from_pem(csr_pem)
            .map_err(|_| "The client CSR is invalid or its signature failed verification")?;
        csr.params.is_ca = IsCa::NoCa;
        csr.params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
        csr.params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ClientAuth];
        csr.params.not_before = OffsetDateTime::now_utc() - time::Duration::minutes(5);
        csr.params.not_after = OffsetDateTime::now_utc() + time::Duration::days(CLIENT_CERT_DAYS);
        let ca_key = KeyPair::try_from(self.stored.ca_key_der.as_slice())
            .map_err(|_| "The local CA key is unavailable".to_string())?;
        let issuer = Issuer::new(ca_params(self.instance_id()), &ca_key);
        let certificate = csr
            .signed_by(&issuer)
            .map_err(|_| "Unable to sign the client certificate".to_string())?;
        let der = certificate.der();
        Ok(SignedClientCertificate {
            certificate_pem: certificate.pem(),
            fingerprint: certificate_fingerprint(der.as_ref()),
            expires_at: (Utc::now() + Duration::days(CLIENT_CERT_DAYS)).to_rfc3339(),
        })
    }
}

fn ca_params(instance_id: &str) -> CertificateParams {
    let mut params = CertificateParams::default();
    params.distinguished_name =
        distinguished_name("Github Auth Local CA", &format!("instance {instance_id}"));
    params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    params.not_before = rcgen::date_time_ymd(2025, 1, 1);
    params.not_after = rcgen::date_time_ymd(2045, 1, 1);
    params.key_usages = vec![
        KeyUsagePurpose::KeyCertSign,
        KeyUsagePurpose::CrlSign,
        KeyUsagePurpose::DigitalSignature,
    ];
    params
}

fn distinguished_name(common_name: &str, organizational_unit: &str) -> DistinguishedName {
    let mut name = DistinguishedName::new();
    name.push(DnType::CommonName, common_name);
    name.push(DnType::OrganizationName, "Github Auth");
    name.push(DnType::OrganizationalUnitName, organizational_unit);
    name
}

pub fn certificate_fingerprint(der: &[u8]) -> String {
    data_encoding::HEXLOWER.encode(&Sha256::digest(der))
}

fn pem_certificate(der: &[u8]) -> String {
    let encoded = STANDARD.encode(der);
    let mut pem = String::from("-----BEGIN CERTIFICATE-----\n");
    for chunk in encoded.as_bytes().chunks(64) {
        pem.push_str(std::str::from_utf8(chunk).unwrap_or_default());
        pem.push('\n');
    }
    pem.push_str("-----END CERTIFICATE-----\n");
    pem
}

#[cfg(windows)]
fn restrict_identity_permissions(path: &std::path::Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::{
            Authorization::{
                ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
            },
            SetFileSecurityW, DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
        },
    };

    let user_sid = current_user_sid()?;
    let sddl = format!("D:P(A;;FA;;;{user_sid})(A;;FA;;;SY)")
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let mut descriptor = ptr::null_mut();
    let converted = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            ptr::null_mut(),
        )
    };
    if converted == 0 {
        return Err(format!(
            "Unable to prepare local API identity permissions: {}",
            std::io::Error::last_os_error()
        ));
    }
    let wide_path = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let applied = unsafe {
        SetFileSecurityW(
            wide_path.as_ptr(),
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            descriptor,
        )
    };
    unsafe { LocalFree(descriptor) };
    if applied == 0 {
        return Err(format!(
            "Unable to restrict local API identity permissions: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

#[cfg(windows)]
fn current_user_sid() -> Result<String, String> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, LocalFree, ERROR_INSUFFICIENT_BUFFER},
        Security::{
            Authorization::ConvertSidToStringSidW, GetTokenInformation, TokenUser, TOKEN_QUERY,
            TOKEN_USER,
        },
        System::Threading::{GetCurrentProcess, OpenProcessToken},
    };

    let mut token = std::ptr::null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(format!(
            "Unable to open the current Windows user token: {}",
            std::io::Error::last_os_error()
        ));
    }
    let result = (|| {
        let mut size = 0_u32;
        let first =
            unsafe { GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut size) };
        if first != 0
            || std::io::Error::last_os_error().raw_os_error()
                != Some(ERROR_INSUFFICIENT_BUFFER as i32)
            || size < size_of::<TOKEN_USER>() as u32
        {
            return Err("Unable to size the current Windows user token".to_string());
        }
        let words = usize::try_from(size)
            .map_err(|_| "The current Windows user token is too large".to_string())?
            .div_ceil(size_of::<usize>());
        let mut storage = vec![0_usize; words];
        if unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                storage.as_mut_ptr().cast(),
                size,
                &mut size,
            )
        } == 0
        {
            return Err(format!(
                "Unable to read the current Windows user token: {}",
                std::io::Error::last_os_error()
            ));
        }
        let token_user = unsafe { &*(storage.as_ptr().cast::<TOKEN_USER>()) };
        let mut string_sid = std::ptr::null_mut();
        if unsafe { ConvertSidToStringSidW(token_user.User.Sid, &mut string_sid) } == 0 {
            return Err(format!(
                "Unable to convert the current Windows user SID: {}",
                std::io::Error::last_os_error()
            ));
        }
        let length = unsafe {
            let mut length = 0_usize;
            while *string_sid.add(length) != 0 {
                length += 1;
            }
            length
        };
        let sid =
            unsafe { String::from_utf16_lossy(std::slice::from_raw_parts(string_sid, length)) };
        unsafe { LocalFree(string_sid.cast()) };
        Ok(sid)
    })();
    unsafe { CloseHandle(token) };
    result
}

#[cfg(not(windows))]
fn restrict_identity_permissions(_path: &std::path::Path) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB},
    };
    let input = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(data.len()).map_err(|_| "Local API identity is too large")?,
        pbData: data.as_ptr() as *mut u8,
    };
    let entropy_bytes = b"com.githubauth.vault:local-api-identity:v1";
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
            "Windows could not protect the local API identity: {}",
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
        cbData: u32::try_from(data.len()).map_err(|_| "Local API identity is too large")?,
        pbData: data.as_ptr() as *mut u8,
    };
    let entropy_bytes = b"com.githubauth.vault:local-api-identity:v1";
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
        return Err("The local API identity is unavailable for this Windows user".to_string());
    }
    let result = unsafe { slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe { LocalFree(output.pbData.cast()) };
    Ok(result)
}

#[cfg(not(windows))]
fn protect(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("The secure local API identity currently requires Windows DPAPI".to_string())
}

#[cfg(not(windows))]
fn unprotect(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("The secure local API identity currently requires Windows DPAPI".to_string())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn different_server_keys_have_different_spki_pins() {
        let first = KeyPair::generate().unwrap();
        let second = KeyPair::generate().unwrap();
        let first_pin = STANDARD.encode(Sha256::digest(first.subject_public_key_info()));
        let second_pin = STANDARD.encode(Sha256::digest(second.subject_public_key_info()));
        assert_ne!(first_pin, second_pin);
    }

    #[test]
    fn dpapi_identity_blob_is_user_bound_and_authenticated() {
        let plaintext = b"local CA, TLS and X25519 private keys";
        let protected = protect(plaintext).unwrap();
        assert_ne!(protected, plaintext);
        assert_eq!(unprotect(&protected).unwrap(), plaintext);
        let mut damaged = protected;
        let last = damaged.len() - 1;
        damaged[last] ^= 1;
        assert!(unprotect(&damaged).is_err());
    }

    #[test]
    fn identity_acl_remains_readable_to_its_windows_owner() {
        let path =
            std::env::temp_dir().join(format!("github-auth-identity-acl-{}", Uuid::new_v4()));
        std::fs::write(&path, b"protected identity test").unwrap();
        restrict_identity_permissions(&path).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"protected identity test");
        std::fs::remove_file(&path).unwrap();
    }
}
