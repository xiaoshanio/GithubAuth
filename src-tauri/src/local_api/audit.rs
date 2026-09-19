use chrono::Utc;
use uuid::Uuid;

use super::models::{ClientApplication, LocalApiConfig, LocalApiLog, PairedClient, MAX_LOGS};

pub struct AuditContext<'a> {
    pub route: &'a str,
    pub action: &'a str,
    pub outcome: &'a str,
    pub application: &'a ClientApplication,
    pub client: Option<&'a PairedClient>,
    pub api_key_name: Option<String>,
    pub group_id: Option<String>,
    pub account_count: usize,
    pub source_pid: Option<u32>,
    pub remote_address: &'a str,
    pub request_id: Option<String>,
    pub detail: String,
}

pub fn append(config: &mut LocalApiConfig, context: AuditContext<'_>) {
    let client = context.client;
    config.logs.insert(
        0,
        LocalApiLog {
            id: Uuid::new_v4().to_string(),
            occurred_at: Utc::now().to_rfc3339(),
            method: None,
            client_id: client.map(|value| value.id.clone()),
            app_name: context.application.name.trim().to_string(),
            developer: context.application.developer.trim().to_string(),
            certificate_fingerprint: client
                .map(|value| abbreviated(&value.certificate_fingerprint)),
            executable_sha256: client
                .filter(|value| !value.executable_sha256.is_empty())
                .map(|value| abbreviated(&value.executable_sha256)),
            api_key_name: context.api_key_name,
            endpoint: context.route.to_string(),
            action: context.action.to_string(),
            outcome: context.outcome.to_string(),
            group_id: context.group_id,
            account_count: context.account_count,
            source_pid: context.source_pid,
            remote_address: context.remote_address.to_string(),
            request_id: context.request_id,
            detail: context.detail,
        },
    );
    config.logs.truncate(MAX_LOGS);
}

fn abbreviated(value: &str) -> String {
    value.chars().take(16).collect()
}
