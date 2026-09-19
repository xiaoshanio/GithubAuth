use chrono::{DateTime, Utc};
use constant_time_eq::constant_time_eq;
use sha2::{Digest, Sha256};

use crate::vault::VaultGroup;

use super::models::{ClientApplication, LocalApiConfig, LocalApiKey, PairedClient, MAX_LOGS};

pub fn validate_config(config: &LocalApiConfig, _groups: &[VaultGroup]) -> Result<(), String> {
    if config.protocol_version != 2
        || config.api_keys.len() > 1_000
        || config.clients.len() > 1_000
        || config.logs.len() > MAX_LOGS
    {
        return Err("Local API configuration contains too many records".to_string());
    }
    if config.api_keys.iter().any(|key| {
        key.id.is_empty()
            || key.id.len() > 128
            || key.name.trim().is_empty()
            || key.name.len() > 128
            || key.key_hash.len() != 64
            || key.group_id.is_empty()
            || key.group_id.len() > 128
            || key.client_id.as_deref().is_some_and(|id| id.len() > 128)
            || key
                .expires_at
                .as_deref()
                .is_some_and(|value| DateTime::parse_from_rfc3339(value).is_err())
    }) {
        return Err("Local API key configuration is invalid".to_string());
    }
    if config.clients.iter().any(|client| {
        client.id.is_empty()
            || client.id.len() > 128
            || client.application_name.trim().is_empty()
            || client.application_name.len() > 128
            || client.developer.trim().is_empty()
            || client.developer.len() > 256
            || client.description.len() > 2_000
            || client.certificate_fingerprint.len() != 64
            || client.encryption_public_key.len() > 128
            || client.executable_path.len() > 4_096
            || client.executable_sha256.len() > 64
            || DateTime::parse_from_rfc3339(&client.created_at).is_err()
            || DateTime::parse_from_rfc3339(&client.expires_at).is_err()
    }) {
        return Err("Paired local API client data is invalid".to_string());
    }
    if config.logs.iter().any(|log| {
        log.id.is_empty()
            || log.app_name.len() > 128
            || log.developer.len() > 256
            || log.detail.len() > 2_048
            || log.endpoint.len() > 128
            || log.remote_address.len() > 128
    }) {
        return Err("Local API log data is invalid".to_string());
    }
    Ok(())
}

pub fn validate_application(application: &ClientApplication) -> Result<(), String> {
    let icon = application.icon.trim();
    let supported_inline_icon = [
        "data:image/png;base64,",
        "data:image/jpeg;base64,",
        "data:image/webp;base64,",
        "data:image/gif;base64,",
        "data:image/x-icon;base64,",
    ]
    .iter()
    .any(|prefix| icon.starts_with(prefix));
    let valid_icon = (icon.starts_with("https://") && icon.len() <= 2_048)
        || (supported_inline_icon && icon.len() <= 262_144);
    if application.name.trim().is_empty()
        || application.name.len() > 128
        || application.developer.trim().is_empty()
        || application.developer.len() > 256
        || application.description.trim().is_empty()
        || application.description.len() > 2_000
        || application.executable_path.len() > 4_096
        || !valid_icon
    {
        return Err(
            "application.name, developer, icon and description are required and must be valid"
                .to_string(),
        );
    }
    Ok(())
}

pub fn key_hash(value: &str) -> String {
    data_encoding::HEXLOWER.encode(&Sha256::digest(value.as_bytes()))
}

pub fn secret_matches(hash: &str, secret: &str) -> bool {
    let candidate = key_hash(secret);
    hash.len() == candidate.len() && constant_time_eq(hash.as_bytes(), candidate.as_bytes())
}

pub fn active_client<'a>(
    config: &'a LocalApiConfig,
    client_id: &str,
    certificate_fingerprint: Option<&str>,
) -> Result<&'a PairedClient, String> {
    let fingerprint = certificate_fingerprint
        .ok_or_else(|| "A valid client certificate is required".to_string())?;
    let client = config
        .clients
        .iter()
        .find(|client| client.id == client_id)
        .ok_or_else(|| "The client has not been paired".to_string())?;
    if !client.enabled {
        return Err("The paired client is paused or revoked".to_string());
    }
    if DateTime::parse_from_rfc3339(&client.expires_at)
        .map(|time| time.with_timezone(&Utc) <= Utc::now())
        .unwrap_or(true)
    {
        return Err("The paired client certificate has expired".to_string());
    }
    if client.certificate_fingerprint.len() != fingerprint.len()
        || !constant_time_eq(
            client.certificate_fingerprint.as_bytes(),
            fingerprint.as_bytes(),
        )
    {
        return Err("The client certificate does not match the paired client".to_string());
    }
    Ok(client)
}

pub fn active_key<'a>(
    config: &'a LocalApiConfig,
    key_id: &str,
    key_secret: &str,
    client_id: &str,
) -> Result<&'a LocalApiKey, String> {
    let key = config
        .api_keys
        .iter()
        .find(|key| key.id == key_id)
        .ok_or_else(|| "The API key is invalid".to_string())?;
    if !key.enabled
        || key.client_id.as_deref() != Some(client_id)
        || key.requires_repair
        || key.expires_at.as_deref().is_some_and(|value| {
            DateTime::parse_from_rfc3339(value)
                .map(|time| time.with_timezone(&Utc) <= Utc::now())
                .unwrap_or(true)
        })
        || !secret_matches(&key.key_hash, key_secret)
    {
        return Err(
            "The API key is invalid, expired, disabled or belongs to another client".to_string(),
        );
    }
    Ok(key)
}

pub fn unbound_key<'a>(
    config: &'a LocalApiConfig,
    key_id: &str,
    key_secret: &str,
    group_id: &str,
) -> Result<&'a LocalApiKey, String> {
    let key = config
        .api_keys
        .iter()
        .find(|key| key.id == key_id && key.group_id == group_id)
        .ok_or_else(|| "The API key is invalid for the requested group".to_string())?;
    if (!key.enabled && !key.requires_repair)
        || key.client_id.is_some()
        || key.expires_at.as_deref().is_some_and(|value| {
            DateTime::parse_from_rfc3339(value)
                .map(|time| time.with_timezone(&Utc) <= Utc::now())
                .unwrap_or(true)
        })
        || !secret_matches(&key.key_hash, key_secret)
    {
        return Err("The API key cannot be paired".to_string());
    }
    Ok(key)
}

pub fn application_matches(client: &PairedClient, application: &ClientApplication) -> bool {
    client.application_name == application.name.trim()
        && client.developer == application.developer.trim()
        && client.description == application.description.trim()
        && client.icon == application.icon.trim()
        && (client.signature_status == "verified"
            || client.executable_path == application.executable_path.trim())
}

pub fn account_scope_valid(
    client: &PairedClient,
    key: &LocalApiKey,
    groups: &[VaultGroup],
) -> bool {
    client.enabled
        && client.allow_read
        && key.enabled
        && !key.group_id.is_empty()
        && client.group_id.as_deref() == Some(key.group_id.as_str())
        && groups.iter().any(|group| group.id == key.group_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client(expires_at: String) -> PairedClient {
        PairedClient {
            id: "client-a".to_string(),
            application_name: "Example".to_string(),
            developer: "Developer".to_string(),
            description: "Purpose".to_string(),
            icon: "https://example.com/icon.png".to_string(),
            certificate_fingerprint: "a".repeat(64),
            encryption_public_key: "b".repeat(44),
            executable_path: String::new(),
            executable_sha256: String::new(),
            authenticode_publisher: String::new(),
            signature_status: "unverified".to_string(),
            allow_import: true,
            allow_read: false,
            group_id: None,
            enabled: true,
            created_at: Utc::now().to_rfc3339(),
            expires_at,
            last_used_at: None,
        }
    }

    #[test]
    fn api_key_comparison_is_scoped_to_the_client() {
        let secret = "gha_secret";
        let mut config = LocalApiConfig::default();
        config.api_keys.push(LocalApiKey {
            id: "key-a".to_string(),
            name: "Team".to_string(),
            key_hash: key_hash(secret),
            group_id: "group-a".to_string(),
            client_id: Some("client-a".to_string()),
            requires_repair: false,
            enabled: true,
            created_at: Utc::now().to_rfc3339(),
            expires_at: None,
            last_used_at: None,
        });
        assert!(active_key(&config, "key-a", secret, "client-a").is_ok());
        assert!(active_key(&config, "key-a", secret, "client-b").is_err());
        assert!(active_key(&config, "key-a", "wrong", "client-a").is_err());
    }

    #[test]
    fn missing_revoked_and_expired_client_certificates_are_rejected() {
        let mut config = LocalApiConfig::default();
        config.clients.push(client(
            (Utc::now() + chrono::Duration::days(1)).to_rfc3339(),
        ));
        assert!(active_client(&config, "client-a", None).is_err());
        assert!(active_client(&config, "client-a", Some(&"a".repeat(64))).is_ok());
        config.clients[0].enabled = false;
        assert!(active_client(&config, "client-a", Some(&"a".repeat(64))).is_err());
        config.clients[0] = client((Utc::now() - chrono::Duration::seconds(1)).to_rfc3339());
        assert!(active_client(&config, "client-a", Some(&"a".repeat(64))).is_err());
    }

    #[test]
    fn legacy_keys_are_disabled_until_pairing_repairs_them() {
        let json = r#"{
          "id":"old","name":"Old","keyHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "groupId":"group-a","enabled":true,"createdAt":"2026-01-01T00:00:00Z","lastUsedAt":null
        }"#;
        let key: LocalApiKey = serde_json::from_str(json).unwrap();
        assert!(key.requires_repair);
        let mut config = LocalApiConfig::default();
        config.api_keys.push(key);
        assert!(active_key(&config, "old", "anything", "client-a").is_err());
    }

    #[test]
    fn legacy_config_stops_reads_and_preserves_audit_records() {
        let json = r#"{
          "exportEnabled":true,
          "apiKeys":[{"id":"old","name":"Old","keyHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","groupId":"group-a","enabled":true,"createdAt":"2026-01-01T00:00:00Z","lastUsedAt":null}],
          "logs":[{"id":"log","occurredAt":"2026-01-01T00:00:00Z","method":"POST","endpoint":"/v1/accounts/query","action":"account_export","outcome":"success","appName":"Legacy","developer":"Legacy","apiKeyName":null,"groupId":"group-a","accountCount":1,"remoteAddress":"127.0.0.1","detail":"Legacy audit"}]
        }"#;
        let config: LocalApiConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.protocol_version, 2);
        assert!(!config.export_enabled);
        assert!(!config.api_keys[0].enabled);
        assert!(config.api_keys[0].requires_repair);
        assert_eq!(config.logs.len(), 1);
    }

    #[test]
    fn read_scope_rejects_import_only_client_other_group_and_deleted_group() {
        let mut client = client((Utc::now() + chrono::Duration::days(1)).to_rfc3339());
        let key = LocalApiKey {
            id: "key-a".to_string(),
            name: "Team".to_string(),
            key_hash: key_hash("secret"),
            group_id: "group-a".to_string(),
            client_id: Some(client.id.clone()),
            requires_repair: false,
            enabled: true,
            created_at: Utc::now().to_rfc3339(),
            expires_at: None,
            last_used_at: None,
        };
        let groups = vec![VaultGroup {
            id: "group-a".to_string(),
            name: "A".to_string(),
            color: "#A855F7".to_string(),
            created_at: Utc::now().to_rfc3339(),
        }];
        assert!(!account_scope_valid(&client, &key, &groups));
        client.allow_read = true;
        client.group_id = Some("group-b".to_string());
        assert!(!account_scope_valid(&client, &key, &groups));
        client.group_id = Some("group-a".to_string());
        assert!(account_scope_valid(&client, &key, &groups));
        assert!(!account_scope_valid(&client, &key, &[]));
        client.enabled = false;
        assert!(!account_scope_valid(&client, &key, &groups));
    }
}
