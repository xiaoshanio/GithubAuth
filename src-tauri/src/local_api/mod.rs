mod audit;
mod commands;
mod envelope;
mod identity;
mod models;
mod permissions;
mod replay;
mod server;
mod tls;
mod windows_identity;

use std::{
    collections::HashMap,
    sync::{atomic::AtomicBool, Arc, Mutex, RwLock},
};

use chrono::{Duration, Utc};
use rustls::ServerConfig;
use tauri::{AppHandle, Emitter, Manager};

use identity::LocalIdentity;
use replay::ReplayGuard;

pub use commands::*;
pub use models::*;
pub use permissions::validate_config;

#[derive(Clone)]
pub(crate) struct PendingPairingRecord {
    pub preview: PendingPairing,
    pub csr_pem: String,
    pub encryption_public_key: [u8; 32],
    pub api_key_id: Option<String>,
}

#[derive(Clone)]
pub(crate) struct PendingImportRecord {
    pub envelope: EncryptedEnvelope,
    pub remote_address: String,
    pub source_pid: Option<u32>,
    pub executable_sha256: String,
    pub authenticode_publisher: String,
    pub signature_status: String,
}

#[derive(Clone)]
pub(crate) struct PendingExportRecord {
    pub preview: PendingApiExport,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReceiptKind {
    Pairing,
    Import,
    Account,
}

#[derive(Clone)]
pub(crate) struct RequestReceipt {
    pub request_id: String,
    pub client_id: String,
    pub kind: ReceiptKind,
    pub status: String,
    pub updated_at: String,
    pub detail: String,
    pub encrypted_response: Option<EncryptedEnvelope>,
    pub delivered: bool,
    pub api_key_id: Option<String>,
    pub group_id: Option<String>,
}

impl RequestReceipt {
    pub(crate) fn take_encrypted_response_once(&mut self) -> Result<EncryptedEnvelope, String> {
        if self.delivered {
            return Err("The encrypted response was already delivered".to_string());
        }
        let response = self
            .encrypted_response
            .take()
            .ok_or_else(|| "The encrypted response is not ready".to_string())?;
        self.delivered = true;
        Ok(response)
    }
}

#[derive(Default)]
pub(crate) struct RuntimeInner {
    pub pairings: HashMap<String, PendingPairingRecord>,
    pub imports: HashMap<String, PendingImportRecord>,
    pub exports: HashMap<String, PendingExportRecord>,
    pub receipts: HashMap<String, RequestReceipt>,
}

impl RuntimeInner {
    pub(crate) fn prune_expired(&mut self) -> bool {
        let cutoff = Utc::now() - Duration::seconds(PENDING_TTL_SECONDS);
        let expired = |time: &str| {
            chrono::DateTime::parse_from_rfc3339(time)
                .map(|value| value.with_timezone(&Utc) < cutoff)
                .unwrap_or(true)
        };
        let before = self.pairings.len() + self.imports.len() + self.exports.len();
        self.pairings
            .retain(|_, record| !expired(&record.preview.requested_at));
        self.imports
            .retain(|_, record| !expired(&record.envelope.timestamp));
        self.exports
            .retain(|_, record| !expired(&record.preview.requested_at));
        for receipt in self.receipts.values_mut() {
            if receipt.status == "pending" && expired(&receipt.updated_at) {
                receipt.status = "expired".to_string();
                receipt.updated_at = Utc::now().to_rfc3339();
                receipt.detail = "The request expired after 10 minutes".to_string();
                receipt.encrypted_response = None;
            }
            if receipt.status == "approved" && expired(&receipt.updated_at) {
                receipt.status = "expired".to_string();
                receipt.updated_at = Utc::now().to_rfc3339();
                receipt.detail = "The approved response expired before delivery".to_string();
                receipt.encrypted_response = None;
            }
        }
        while self.receipts.len() > 100 {
            let oldest = self
                .receipts
                .iter()
                .min_by_key(|(_, receipt)| &receipt.updated_at)
                .map(|(id, _)| id.clone());
            if let Some(id) = oldest {
                self.receipts.remove(&id);
            } else {
                break;
            }
        }
        before != self.pairings.len() + self.imports.len() + self.exports.len()
    }
}

pub struct LocalApiRuntime {
    pub(crate) listening: AtomicBool,
    pub(crate) inner: Mutex<RuntimeInner>,
    pub(crate) identity: RwLock<Option<Arc<LocalIdentity>>>,
    pub(crate) tls_config: RwLock<Option<Arc<ServerConfig>>>,
    pub(crate) replay: Mutex<Option<ReplayGuard>>,
}

impl Default for LocalApiRuntime {
    fn default() -> Self {
        Self {
            listening: AtomicBool::new(false),
            inner: Mutex::new(RuntimeInner::default()),
            identity: RwLock::new(None),
            tls_config: RwLock::new(None),
            replay: Mutex::new(None),
        }
    }
}

impl LocalApiRuntime {
    pub(crate) fn initialize(&self, app: &AppHandle) -> Result<(), String> {
        let identity = Arc::new(LocalIdentity::load_or_create(app)?);
        let tls_config = tls::server_config(&identity)?;
        let replay = ReplayGuard::load(app)?;
        *self
            .identity
            .write()
            .map_err(|_| "The local API identity lock is unavailable".to_string())? =
            Some(identity);
        *self
            .tls_config
            .write()
            .map_err(|_| "The local TLS configuration lock is unavailable".to_string())? =
            Some(tls_config);
        *self
            .replay
            .lock()
            .map_err(|_| "The replay cache is unavailable".to_string())? = Some(replay);
        Ok(())
    }

    pub(crate) fn current_identity(&self) -> Result<Arc<LocalIdentity>, String> {
        self.identity
            .read()
            .map_err(|_| "The local API identity lock is unavailable".to_string())?
            .clone()
            .ok_or_else(|| "The local API identity is unavailable".to_string())
    }

    pub(crate) fn current_tls_config(&self) -> Result<Arc<ServerConfig>, String> {
        self.tls_config
            .read()
            .map_err(|_| "The local TLS configuration lock is unavailable".to_string())?
            .clone()
            .ok_or_else(|| "The local TLS configuration is unavailable".to_string())
    }

    pub(crate) fn clear_pending(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            *inner = RuntimeInner::default();
        }
    }
}

pub(crate) fn notify_state_changed(app: &AppHandle) {
    let _ = app.emit("local-api-state-changed", ());
}

pub(crate) fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn start_server(app: AppHandle) {
    let runtime = app.state::<LocalApiRuntime>();
    if let Err(error) = runtime.initialize(&app) {
        let _ = app.emit("local-api-runtime-error", error);
        return;
    }
    tauri::async_runtime::spawn(server::run(app));
}

pub fn on_vault_locked(runtime: &LocalApiRuntime) {
    runtime.clear_pending();
}

pub fn reset_security(app: &AppHandle, runtime: &LocalApiRuntime) -> Result<(), String> {
    runtime.clear_pending();
    replay::ReplayGuard::clear(app)?;
    identity::LocalIdentity::reset(app)?;
    let identity = Arc::new(identity::LocalIdentity::load_or_create(app)?);
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
        Some(replay::ReplayGuard::load(app)?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypted_receipts_can_only_be_delivered_once() {
        let mut receipt = RequestReceipt {
            request_id: "request".to_string(),
            client_id: "client".to_string(),
            kind: ReceiptKind::Account,
            status: "approved".to_string(),
            updated_at: "2026-09-19T00:00:00Z".to_string(),
            detail: String::new(),
            encrypted_response: Some(EncryptedEnvelope {
                version: 2,
                instance_id: "instance".to_string(),
                client_id: "client".to_string(),
                request_id: "request".to_string(),
                timestamp: "2026-09-19T00:00:00Z".to_string(),
                route: "/v2/account-responses".to_string(),
                ephemeral_public_key: "public".to_string(),
                nonce: "nonce".to_string(),
                ciphertext: "ciphertext".to_string(),
                key_id: None,
            }),
            delivered: false,
            api_key_id: None,
            group_id: None,
        };
        assert!(receipt.take_encrypted_response_once().is_ok());
        assert!(receipt.take_encrypted_response_once().is_err());
    }
}
