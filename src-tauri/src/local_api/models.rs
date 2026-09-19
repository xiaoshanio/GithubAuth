use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

pub const LOCAL_API_PORT: u16 = 46_329;
pub const PROTOCOL_VERSION: u8 = 2;
pub const MAX_LOGS: usize = 500;
pub const MAX_REQUEST_BYTES: usize = 1024 * 1024;
pub const PENDING_TTL_SECONDS: i64 = 10 * 60;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase", from = "StoredLocalApiConfig")]
pub struct LocalApiConfig {
    pub protocol_version: u8,
    pub export_enabled: bool,
    pub api_keys: Vec<LocalApiKey>,
    pub clients: Vec<PairedClient>,
    pub logs: Vec<LocalApiLog>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct StoredLocalApiConfig {
    #[serde(default)]
    protocol_version: Option<u8>,
    #[serde(default)]
    export_enabled: bool,
    #[serde(default)]
    api_keys: Vec<LocalApiKey>,
    #[serde(default)]
    clients: Vec<PairedClient>,
    #[serde(default)]
    logs: Vec<LocalApiLog>,
}

impl From<StoredLocalApiConfig> for LocalApiConfig {
    fn from(stored: StoredLocalApiConfig) -> Self {
        let mut keys = stored.api_keys;
        let current = stored.protocol_version == Some(PROTOCOL_VERSION);
        if !current {
            for key in &mut keys {
                key.enabled = false;
                key.requires_repair = true;
                key.client_id = None;
            }
        }
        Self {
            protocol_version: PROTOCOL_VERSION,
            export_enabled: current && stored.export_enabled,
            api_keys: keys,
            clients: if current { stored.clients } else { Vec::new() },
            logs: stored.logs,
        }
    }
}

impl Default for LocalApiConfig {
    fn default() -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            export_enabled: false,
            api_keys: Vec::new(),
            clients: Vec::new(),
            logs: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LocalApiKey {
    pub id: String,
    pub name: String,
    pub key_hash: String,
    pub group_id: String,
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default = "repair_required")]
    pub requires_repair: bool,
    #[serde(default)]
    pub enabled: bool,
    pub created_at: String,
    #[serde(default)]
    pub expires_at: Option<String>,
    pub last_used_at: Option<String>,
}

fn repair_required() -> bool {
    true
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PairedClient {
    pub id: String,
    pub application_name: String,
    pub developer: String,
    pub description: String,
    pub icon: String,
    pub certificate_fingerprint: String,
    pub encryption_public_key: String,
    #[serde(default)]
    pub executable_path: String,
    #[serde(default)]
    pub executable_sha256: String,
    #[serde(default)]
    pub authenticode_publisher: String,
    #[serde(default = "unverified_signature")]
    pub signature_status: String,
    #[serde(default)]
    pub allow_import: bool,
    #[serde(default)]
    pub allow_read: bool,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default = "enabled_by_default")]
    pub enabled: bool,
    pub created_at: String,
    pub expires_at: String,
    #[serde(default)]
    pub last_used_at: Option<String>,
}

fn unverified_signature() -> String {
    "unverified".to_string()
}

fn enabled_by_default() -> bool {
    true
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LocalApiLog {
    pub id: String,
    pub occurred_at: String,
    #[serde(default)]
    pub method: Option<String>,
    pub client_id: Option<String>,
    pub app_name: String,
    pub developer: String,
    pub certificate_fingerprint: Option<String>,
    pub executable_sha256: Option<String>,
    pub api_key_name: Option<String>,
    pub endpoint: String,
    pub action: String,
    pub outcome: String,
    pub group_id: Option<String>,
    pub account_count: usize,
    pub source_pid: Option<u32>,
    pub remote_address: String,
    pub request_id: Option<String>,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ClientApplication {
    pub name: String,
    pub developer: String,
    pub icon: String,
    pub description: String,
    #[serde(default)]
    pub executable_path: String,
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
    pub client_id: String,
    pub application: ClientApplication,
    pub purpose: String,
    pub accounts: Vec<IncomingAccount>,
    pub requested_at: String,
    pub remote_address: String,
    pub source_pid: Option<u32>,
    pub executable_sha256: String,
    pub authenticode_publisher: String,
    pub signature_status: String,
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
    pub client_id: String,
    pub application: ClientApplication,
    pub purpose: String,
    pub api_key_name: String,
    pub api_key_id: String,
    pub group_id: String,
    pub group_name: String,
    pub accounts: Vec<ExportAccountPreview>,
    pub requested_at: String,
    pub remote_address: String,
    pub source_pid: Option<u32>,
    pub executable_path: String,
    pub executable_sha256: String,
    pub authenticode_publisher: String,
    pub signature_status: String,
}

#[derive(Clone, Debug, Serialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct PendingPairing {
    pub id: String,
    pub client_id: String,
    pub application: ClientApplication,
    pub purpose: String,
    pub allow_import: bool,
    pub allow_read: bool,
    pub group_id: Option<String>,
    pub group_name: Option<String>,
    pub requested_at: String,
    pub remote_address: String,
    pub source_pid: Option<u32>,
    pub executable_path: String,
    pub executable_sha256: String,
    pub authenticode_publisher: String,
    pub signature_status: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalApiRuntimeStatus {
    pub listening: bool,
    pub base_url: String,
    pub import_endpoint: String,
    pub account_endpoint: String,
    pub pairing_endpoint: String,
    pub protocol_version: u8,
    pub tls13: bool,
    pub mtls: bool,
    pub instance_id: String,
    pub spki_fingerprint: String,
    pub server_encryption_public_key: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedApiKey {
    pub key_id: String,
    pub api_key: String,
    pub config: LocalApiConfig,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EncryptedEnvelope {
    pub version: u8,
    pub instance_id: String,
    pub client_id: String,
    pub request_id: String,
    pub timestamp: String,
    pub route: String,
    pub ephemeral_public_key: String,
    pub nonce: String,
    pub ciphertext: String,
    #[serde(default)]
    pub key_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ImportRequestBody {
    pub application: ClientApplication,
    pub purpose: String,
    pub accounts: Vec<IncomingAccount>,
}

#[derive(Clone, Debug, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AccountRequestBody {
    pub application: ClientApplication,
    pub purpose: String,
    pub key_id: String,
    pub key_secret: String,
}

#[derive(Clone, Debug, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct StatusRequestBody {
    pub request_id: String,
    #[serde(default)]
    pub key_id: Option<String>,
    #[serde(default)]
    pub key_secret: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PairingRequestBody {
    pub application: ClientApplication,
    pub purpose: String,
    pub client_csr: String,
    pub encryption_public_key: String,
    pub allow_import: bool,
    pub allow_read: bool,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub key_id: Option<String>,
    #[serde(default)]
    pub key_secret: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ApproveImportInput {
    pub request_id: String,
    pub group_id: Option<String>,
    pub new_group_name: Option<String>,
    pub auth_kind: String,
    pub credential: String,
}
