use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::Utc;
use pbkdf2::pbkdf2_hmac;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::collections::HashSet;
use uuid::Uuid;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

pub const MAX_VAULT_BYTES: usize = 10 * 1024 * 1024;
const VAULT_FORMAT: &str = "github-auth-vault";
const VAULT_VERSION: u8 = 2;
const ARGON_MEMORY_KIB: u32 = 65_536;
const ARGON_ITERATIONS: u32 = 3;
const ARGON_PARALLELISM: u32 = 1;
const LEGACY_PBKDF2_ITERATIONS: u32 = 310_000;
const WRAP_AAD: &[u8] = b"github-auth-vault:v2:data-key";
const PAYLOAD_AAD: &[u8] = b"github-auth-vault:v2:payload";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VaultGroup {
    pub id: String,
    pub name: String,
    pub color: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VaultAccount {
    pub id: String,
    pub name: String,
    pub email: String,
    pub password: String,
    pub totp_secret: String,
    pub group_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github_created_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VaultSettings {
    pub language: String,
    pub clipboard_clear_seconds: u32,
}

impl Default for VaultSettings {
    fn default() -> Self {
        Self {
            language: "zh-CN".to_string(),
            clipboard_clear_seconds: 30,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VaultPayload {
    pub groups: Vec<VaultGroup>,
    pub accounts: Vec<VaultAccount>,
    pub settings: VaultSettings,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct KdfParameters {
    pub algorithm: String,
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
    pub salt: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EncryptedSection {
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VaultEnvelopeV2 {
    pub format: String,
    pub version: u8,
    pub vault_id: String,
    pub kdf: KdfParameters,
    pub password_key_wrap: EncryptedSection,
    pub payload: EncryptedSection,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct LegacyEnvelopeV1 {
    version: u8,
    salt: String,
    iv: String,
    ciphertext: String,
    updated_at: String,
}

pub struct UnlockedVault {
    pub envelope: VaultEnvelopeV2,
    pub payload: VaultPayload,
    pub data_key: Zeroizing<Vec<u8>>,
    pub migrated: bool,
}

fn random_bytes(length: usize) -> Vec<u8> {
    let mut bytes = vec![0_u8; length];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

fn decode(value: &str, field: &str) -> Result<Vec<u8>, String> {
    STANDARD
        .decode(value)
        .map_err(|_| format!("Encrypted vault {field} is invalid"))
}

fn validate_kdf(parameters: &KdfParameters) -> Result<(), String> {
    if parameters.algorithm != "argon2id"
        || !(19_456..=262_144).contains(&parameters.memory_kib)
        || !(1..=10).contains(&parameters.iterations)
        || !(1..=8).contains(&parameters.parallelism)
    {
        return Err("Encrypted vault KDF parameters are unsupported".to_string());
    }
    if !(16..=64).contains(&decode(&parameters.salt, "salt")?.len()) {
        return Err("Encrypted vault salt is invalid".to_string());
    }
    Ok(())
}

pub fn validate_v2(envelope: &VaultEnvelopeV2) -> Result<(), String> {
    if envelope.format != VAULT_FORMAT
        || envelope.version != VAULT_VERSION
        || Uuid::parse_str(&envelope.vault_id).is_err()
        || chrono::DateTime::parse_from_rfc3339(&envelope.updated_at).is_err()
    {
        return Err("Encrypted vault envelope is incomplete".to_string());
    }
    validate_kdf(&envelope.kdf)?;
    if decode(&envelope.password_key_wrap.nonce, "key nonce")?.len() != 12
        || decode(&envelope.payload.nonce, "payload nonce")?.len() != 12
        || decode(&envelope.password_key_wrap.ciphertext, "wrapped key")?.len() < 48
        || decode(&envelope.payload.ciphertext, "ciphertext")?.len() < 16
    {
        return Err("Encrypted vault envelope is incomplete".to_string());
    }
    Ok(())
}

fn derive_password_key(
    password: &str,
    parameters: &KdfParameters,
) -> Result<Zeroizing<Vec<u8>>, String> {
    validate_kdf(parameters)?;
    let salt = decode(&parameters.salt, "salt")?;
    let params = Params::new(
        parameters.memory_kib,
        parameters.iterations,
        parameters.parallelism,
        Some(32),
    )
    .map_err(|_| "Encrypted vault KDF parameters are unsupported".to_string())?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new(vec![0_u8; 32]);
    argon
        .hash_password_into(password.as_bytes(), &salt, &mut key)
        .map_err(|_| "Unable to derive the vault key".to_string())?;
    Ok(key)
}

fn encrypt(key: &[u8], plaintext: &[u8], aad: &[u8]) -> Result<EncryptedSection, String> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| "Unable to initialize encryption".to_string())?;
    let nonce_bytes = random_bytes(12);
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| "Unable to encrypt the vault".to_string())?;
    Ok(EncryptedSection {
        nonce: STANDARD.encode(nonce_bytes),
        ciphertext: STANDARD.encode(ciphertext),
    })
}

fn decrypt(
    key: &[u8],
    section: &EncryptedSection,
    aad: &[u8],
) -> Result<Zeroizing<Vec<u8>>, String> {
    let nonce = decode(&section.nonce, "nonce")?;
    if nonce.len() != 12 {
        return Err("Encrypted vault nonce is invalid".to_string());
    }
    let ciphertext = decode(&section.ciphertext, "ciphertext")?;
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| "Unable to initialize decryption".to_string())?;
    cipher
        .decrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad,
            },
        )
        .map(Zeroizing::new)
        .map_err(|_| "The password is incorrect or the encrypted data was modified".to_string())
}

fn default_kdf() -> KdfParameters {
    KdfParameters {
        algorithm: "argon2id".to_string(),
        memory_kib: ARGON_MEMORY_KIB,
        iterations: ARGON_ITERATIONS,
        parallelism: ARGON_PARALLELISM,
        salt: STANDARD.encode(random_bytes(16)),
    }
}

pub fn create_vault(password: &str, payload: VaultPayload) -> Result<UnlockedVault, String> {
    if password.chars().count() < 12 {
        return Err("The master password must contain at least 12 characters".to_string());
    }
    if password.len() > 4096 {
        return Err("The master password is too long".to_string());
    }
    let data_key = Zeroizing::new(random_bytes(32));
    let kdf = default_kdf();
    let password_key = derive_password_key(password, &kdf)?;
    let wrapped_key = encrypt(&password_key, &data_key, WRAP_AAD)?;
    let payload_bytes = Zeroizing::new(
        serde_json::to_vec(&payload).map_err(|_| "Unable to serialize the vault".to_string())?,
    );
    let encrypted_payload = encrypt(&data_key, &payload_bytes, PAYLOAD_AAD)?;
    let envelope = VaultEnvelopeV2 {
        format: VAULT_FORMAT.to_string(),
        version: VAULT_VERSION,
        vault_id: Uuid::new_v4().to_string(),
        kdf,
        password_key_wrap: wrapped_key,
        payload: encrypted_payload,
        updated_at: Utc::now().to_rfc3339(),
    };
    Ok(UnlockedVault {
        envelope,
        payload,
        data_key,
        migrated: false,
    })
}

pub fn unlock_v2(envelope: VaultEnvelopeV2, password: &str) -> Result<UnlockedVault, String> {
    validate_v2(&envelope)?;
    let password_key = derive_password_key(password, &envelope.kdf)?;
    let data_key = decrypt(&password_key, &envelope.password_key_wrap, WRAP_AAD)?;
    if data_key.len() != 32 {
        return Err("Encrypted vault data key is invalid".to_string());
    }
    unlock_with_data_key(envelope, data_key, false)
}

pub fn unlock_with_data_key(
    envelope: VaultEnvelopeV2,
    data_key: Zeroizing<Vec<u8>>,
    migrated: bool,
) -> Result<UnlockedVault, String> {
    validate_v2(&envelope)?;
    let payload_bytes = decrypt(&data_key, &envelope.payload, PAYLOAD_AAD)?;
    let payload = serde_json::from_slice::<VaultPayload>(&payload_bytes)
        .map_err(|_| "Encrypted vault payload is invalid".to_string())?;
    validate_payload(&payload)?;
    Ok(UnlockedVault {
        envelope,
        payload,
        data_key,
        migrated,
    })
}

pub fn encrypt_payload(
    envelope: &VaultEnvelopeV2,
    data_key: &[u8],
    payload: &VaultPayload,
) -> Result<VaultEnvelopeV2, String> {
    validate_payload(payload)?;
    let payload_bytes = Zeroizing::new(
        serde_json::to_vec(payload).map_err(|_| "Unable to serialize the vault".to_string())?,
    );
    let mut next = envelope.clone();
    next.payload = encrypt(data_key, &payload_bytes, PAYLOAD_AAD)?;
    next.updated_at = Utc::now().to_rfc3339();
    Ok(next)
}

pub fn change_password(
    envelope: &VaultEnvelopeV2,
    data_key: &[u8],
    current_password: &str,
    new_password: &str,
) -> Result<VaultEnvelopeV2, String> {
    if new_password.chars().count() < 12 || new_password.len() > 4096 {
        return Err("The new master password must contain at least 12 characters".to_string());
    }
    let current_key = derive_password_key(current_password, &envelope.kdf)?;
    let current_data_key = decrypt(&current_key, &envelope.password_key_wrap, WRAP_AAD)?;
    if current_data_key.as_slice() != data_key {
        return Err("The current master password is incorrect".to_string());
    }
    let kdf = default_kdf();
    let new_key = derive_password_key(new_password, &kdf)?;
    let mut next = envelope.clone();
    next.kdf = kdf;
    next.password_key_wrap = encrypt(&new_key, data_key, WRAP_AAD)?;
    next.updated_at = Utc::now().to_rfc3339();
    Ok(next)
}

pub fn verify_password(
    envelope: &VaultEnvelopeV2,
    expected_data_key: &[u8],
    password: &str,
) -> Result<(), String> {
    let key = derive_password_key(password, &envelope.kdf)?;
    let data_key = decrypt(&key, &envelope.password_key_wrap, WRAP_AAD)?;
    if data_key.as_slice() != expected_data_key {
        return Err("The current master password is incorrect".to_string());
    }
    Ok(())
}

pub fn parse_v2(contents: &str) -> Result<VaultEnvelopeV2, String> {
    if contents.len() > MAX_VAULT_BYTES {
        return Err("Encrypted vault is larger than the allowed limit".to_string());
    }
    let envelope = serde_json::from_str::<VaultEnvelopeV2>(contents)
        .map_err(|_| "Encrypted vault has an invalid v2 envelope".to_string())?;
    validate_v2(&envelope)?;
    Ok(envelope)
}

pub fn serialize_v2(envelope: &VaultEnvelopeV2) -> Result<String, String> {
    validate_v2(envelope)?;
    let serialized = serde_json::to_string(envelope)
        .map_err(|_| "Unable to serialize the encrypted vault".to_string())?;
    // Refuse oversized envelopes before any caller replaces the vault on disk:
    // read_limited rejects files above this limit, so writing one would leave an
    // unreadable vault behind.
    if serialized.len() > MAX_VAULT_BYTES {
        return Err("Encrypted vault is larger than the allowed limit".to_string());
    }
    Ok(serialized)
}

pub fn unlock_any(contents: &str, password: &str) -> Result<UnlockedVault, String> {
    if contents.len() > MAX_VAULT_BYTES {
        return Err("Encrypted vault is larger than the allowed limit".to_string());
    }
    let value: serde_json::Value = serde_json::from_str(contents)
        .map_err(|_| "Encrypted vault has an invalid JSON envelope".to_string())?;
    match value.get("version").and_then(serde_json::Value::as_u64) {
        Some(2) => unlock_v2(parse_v2(contents)?, password),
        Some(1) => unlock_legacy(contents, password),
        _ => Err("Encrypted vault version is unsupported".to_string()),
    }
}

fn unlock_legacy(contents: &str, password: &str) -> Result<UnlockedVault, String> {
    let legacy = serde_json::from_str::<LegacyEnvelopeV1>(contents)
        .map_err(|_| "Encrypted vault has an invalid legacy envelope".to_string())?;
    let salt = decode(&legacy.salt, "salt")?;
    let nonce = decode(&legacy.iv, "IV")?;
    let ciphertext = decode(&legacy.ciphertext, "ciphertext")?;
    if legacy.version != 1
        || salt.len() != 16
        || nonce.len() != 12
        || ciphertext.len() < 16
        || legacy.updated_at.is_empty()
    {
        return Err("Encrypted vault legacy envelope is incomplete".to_string());
    }
    let mut key = Zeroizing::new(vec![0_u8; 32]);
    pbkdf2_hmac::<Sha256>(
        password.as_bytes(),
        &salt,
        LEGACY_PBKDF2_ITERATIONS,
        &mut key,
    );
    let cipher = Aes256Gcm::new_from_slice(&key)
        .map_err(|_| "Unable to initialize legacy decryption".to_string())?;
    let mut plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|_| "The password is incorrect or the encrypted data was modified".to_string())?;
    let payload = serde_json::from_slice::<VaultPayload>(&plaintext)
        .map_err(|_| "Encrypted vault payload is invalid".to_string())?;
    plaintext.zeroize();
    validate_payload(&payload)?;
    let mut migrated = create_vault(password, payload)?;
    migrated.migrated = true;
    Ok(migrated)
}

pub fn validate_payload(payload: &VaultPayload) -> Result<(), String> {
    if payload.groups.len() > 10_000 || payload.accounts.len() > 100_000 {
        return Err("Vault payload contains too many records".to_string());
    }
    if !matches!(payload.settings.language.as_str(), "zh-CN" | "en")
        || payload.settings.clipboard_clear_seconds > 120
    {
        return Err("Vault settings are invalid".to_string());
    }
    if payload.groups.iter().any(|group| {
        group.id.is_empty()
            || group.id.len() > 128
            || group.name.is_empty()
            || group.name.len() > 256
            || group.color.len() > 32
    }) {
        return Err("Vault group data is invalid".to_string());
    }
    if payload.accounts.iter().any(|account| {
        account.id.is_empty()
            || account.id.len() > 128
            || account.name.is_empty()
            || account.name.len() > 256
            || account.email.len() > 512
            || account.password.len() > 16_384
            || account.totp_secret.len() > 4096
            || account.group_id.len() > 128
            // The avatar is rendered as an image source, so bound its length and
            // require an https origin instead of trusting whatever a backup carries.
            || account
                .avatar_url
                .as_deref()
                .is_some_and(|url| url.len() > 2_048 || !url.starts_with("https://"))
            || account
                .github_created_at
                .as_deref()
                .is_some_and(|created_at| created_at.len() > 64)
    }) {
        return Err("Vault account data is invalid".to_string());
    }
    let group_ids = payload
        .groups
        .iter()
        .map(|group| group.id.as_str())
        .collect::<HashSet<_>>();
    if group_ids.len() != payload.groups.len() {
        return Err("Vault group IDs must be unique".to_string());
    }
    let account_ids = payload
        .accounts
        .iter()
        .map(|account| account.id.as_str())
        .collect::<HashSet<_>>();
    if account_ids.len() != payload.accounts.len() {
        return Err("Vault account IDs must be unique".to_string());
    }
    if payload.accounts.iter().any(|account| {
        !account.group_id.is_empty() && !group_ids.contains(account.group_id.as_str())
    }) {
        return Err("Vault account references an unknown group".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PASSWORD: &str = "correct horse battery staple";
    const NEXT_PASSWORD: &str = "different long master password";

    fn sample_payload() -> VaultPayload {
        VaultPayload {
            groups: vec![VaultGroup {
                id: "group-1".to_string(),
                name: "Private".to_string(),
                color: "#A855F7".to_string(),
                created_at: "2026-08-15T00:00:00.000Z".to_string(),
            }],
            accounts: vec![VaultAccount {
                id: "account-1".to_string(),
                name: "octocat".to_string(),
                email: "secret@example.com".to_string(),
                password: "never-store-this-in-plaintext".to_string(),
                totp_secret: "JBSWY3DPEHPK3PXP".to_string(),
                group_id: "group-1".to_string(),
                avatar_url: None,
                github_created_at: None,
                created_at: "2026-08-15T00:00:00.000Z".to_string(),
                updated_at: "2026-08-15T00:00:00.000Z".to_string(),
            }],
            settings: VaultSettings::default(),
        }
    }

    #[test]
    fn v2_round_trip_and_password_change() {
        let payload = sample_payload();
        let created = create_vault(PASSWORD, payload.clone()).unwrap();
        let serialized = serialize_v2(&created.envelope).unwrap();
        assert!(!serialized.contains("never-store-this-in-plaintext"));
        assert!(!serialized.contains("secret@example.com"));

        let unlocked = unlock_any(&serialized, PASSWORD).unwrap();
        assert_eq!(unlocked.payload, payload);
        let changed = change_password(
            &unlocked.envelope,
            &unlocked.data_key,
            PASSWORD,
            NEXT_PASSWORD,
        )
        .unwrap();
        let changed_serialized = serialize_v2(&changed).unwrap();
        assert!(unlock_any(&changed_serialized, PASSWORD).is_err());
        assert_eq!(
            unlock_any(&changed_serialized, NEXT_PASSWORD)
                .unwrap()
                .payload,
            payload
        );
    }

    #[test]
    fn rejects_tampered_ciphertext_and_unknown_fields() {
        let created = create_vault(PASSWORD, sample_payload()).unwrap();
        let mut tampered = created.envelope.clone();
        let mut bytes = STANDARD.decode(&tampered.payload.ciphertext).unwrap();
        bytes[0] ^= 1;
        tampered.payload.ciphertext = STANDARD.encode(bytes);
        assert!(unlock_v2(tampered, PASSWORD).is_err());

        let mut value = serde_json::to_value(&created.envelope).unwrap();
        value["plaintextPassword"] = serde_json::Value::String("secret".to_string());
        assert!(parse_v2(&value.to_string()).is_err());
    }

    #[test]
    fn rejects_invalid_v2_metadata_and_oversized_kdf_salts() {
        let created = create_vault(PASSWORD, sample_payload()).unwrap();

        let mut invalid_time = created.envelope.clone();
        invalid_time.updated_at = "not-a-timestamp".to_string();
        assert!(validate_v2(&invalid_time).is_err());

        let mut oversized_salt = created.envelope;
        oversized_salt.kdf.salt = STANDARD.encode(vec![0_u8; 65]);
        assert!(validate_v2(&oversized_salt).is_err());
    }

    #[test]
    fn rejects_duplicate_ids_and_dangling_group_references() {
        let mut duplicate_groups = sample_payload();
        duplicate_groups
            .groups
            .push(duplicate_groups.groups[0].clone());
        assert!(validate_payload(&duplicate_groups).is_err());

        let mut duplicate_accounts = sample_payload();
        duplicate_accounts
            .accounts
            .push(duplicate_accounts.accounts[0].clone());
        assert!(validate_payload(&duplicate_accounts).is_err());

        let mut dangling_group = sample_payload();
        dangling_group.accounts[0].group_id = "missing-group".to_string();
        assert!(validate_payload(&dangling_group).is_err());
    }

    #[test]
    fn every_payload_write_uses_a_fresh_nonce() {
        let created = create_vault(PASSWORD, sample_payload()).unwrap();
        let first =
            encrypt_payload(&created.envelope, &created.data_key, &created.payload).unwrap();
        let second =
            encrypt_payload(&created.envelope, &created.data_key, &created.payload).unwrap();
        assert_ne!(first.payload.nonce, second.payload.nonce);
        assert_ne!(first.payload.ciphertext, second.payload.ciphertext);
    }

    #[test]
    fn rejects_untrusted_avatar_sources_and_oversized_profile_metadata() {
        let mut hostile_scheme = sample_payload();
        hostile_scheme.accounts[0].avatar_url = Some("javascript:alert(1)".to_string());
        assert!(validate_payload(&hostile_scheme).is_err());

        let mut oversized_avatar = sample_payload();
        oversized_avatar.accounts[0].avatar_url = Some(format!("https://{}", "a".repeat(2_048)));
        assert!(validate_payload(&oversized_avatar).is_err());

        let mut oversized_created_at = sample_payload();
        oversized_created_at.accounts[0].github_created_at = Some("2".repeat(65));
        assert!(validate_payload(&oversized_created_at).is_err());

        let mut accepted = sample_payload();
        accepted.accounts[0].avatar_url =
            Some("https://avatars.githubusercontent.com/u/583231".to_string());
        accepted.accounts[0].github_created_at = Some("2011-01-25T18:44:36Z".to_string());
        assert!(validate_payload(&accepted).is_ok());
    }

    #[test]
    fn refuses_to_serialize_an_envelope_past_the_readable_size_limit() {
        let mut payload = sample_payload();
        payload.accounts[0].password = "p".repeat(16_384);
        for index in 0..900 {
            let mut account = payload.accounts[0].clone();
            account.id = format!("bulk-{index}");
            payload.accounts.push(account);
        }
        let created = create_vault(PASSWORD, payload).unwrap();

        let error = serialize_v2(&created.envelope).unwrap_err();
        assert!(error.contains("larger than the allowed limit"));
    }

    #[test]
    fn legacy_v1_unlock_migrates_to_v2_without_changing_payload() {
        let payload = sample_payload();
        let salt = random_bytes(16);
        let nonce = random_bytes(12);
        let mut key = Zeroizing::new(vec![0_u8; 32]);
        pbkdf2_hmac::<Sha256>(
            PASSWORD.as_bytes(),
            &salt,
            LEGACY_PBKDF2_ITERATIONS,
            &mut key,
        );
        let plaintext = serde_json::to_vec(&payload).unwrap();
        let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
        let ciphertext = cipher
            .encrypt(Nonce::from_slice(&nonce), plaintext.as_ref())
            .unwrap();
        let legacy = serde_json::json!({
            "version": 1,
            "salt": STANDARD.encode(salt),
            "iv": STANDARD.encode(nonce),
            "ciphertext": STANDARD.encode(ciphertext),
            "updatedAt": "2026-08-15T00:00:00.000Z"
        })
        .to_string();

        assert!(unlock_any(&legacy, NEXT_PASSWORD).is_err());
        let migrated = unlock_any(&legacy, PASSWORD).unwrap();
        assert!(migrated.migrated);
        assert_eq!(migrated.envelope.version, 2);
        assert_eq!(migrated.payload, payload);
    }
}
