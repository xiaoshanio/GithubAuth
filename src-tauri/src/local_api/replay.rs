use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::PathBuf,
};

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::storage::{app_data_dir, atomic_write, read_limited, remove_if_exists};

use super::models::EncryptedEnvelope;

const REPLAY_FILE: &str = "local-api-replay.json";
const MAX_REPLAY_FILE_BYTES: usize = 512 * 1024;
const MAX_RECORDS: usize = 4_096;
const WINDOW_SECONDS: i64 = 30;
const FUTURE_TOLERANCE_SECONDS: i64 = 5;
const RATE_WINDOW_SECONDS: i64 = 60;
const RATE_LIMIT_PER_CLIENT: usize = 60;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ReplayRecord {
    client_id: String,
    request_id: String,
    nonce: String,
    accepted_at: String,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PersistedReplay {
    records: Vec<ReplayRecord>,
}

pub struct ReplayGuard {
    path: Option<PathBuf>,
    records: VecDeque<ReplayRecord>,
    request_ids: HashSet<(String, String)>,
    nonces: HashSet<(String, String)>,
    recent_requests: HashMap<String, VecDeque<DateTime<Utc>>>,
}

impl ReplayGuard {
    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let path = app_data_dir(app)?.join(REPLAY_FILE);
        let persisted = match read_limited(&path, MAX_REPLAY_FILE_BYTES)? {
            Some(bytes) => serde_json::from_slice::<PersistedReplay>(&bytes).map_err(|_| {
                "The local API replay cache is damaged; rotate the local API identity".to_string()
            })?,
            None => PersistedReplay::default(),
        };
        Ok(Self::from_records(Some(path), persisted.records))
    }

    fn from_records(path: Option<PathBuf>, records: Vec<ReplayRecord>) -> Self {
        let cutoff = Utc::now() - Duration::seconds(WINDOW_SECONDS * 4);
        let records = records
            .into_iter()
            .filter(|record| {
                DateTime::parse_from_rfc3339(&record.accepted_at)
                    .map(|time| time.with_timezone(&Utc) >= cutoff)
                    .unwrap_or(false)
            })
            .collect::<VecDeque<_>>();
        let request_ids = records
            .iter()
            .map(|record| (record.client_id.clone(), record.request_id.clone()))
            .collect();
        let nonces = records
            .iter()
            .map(|record| (record.client_id.clone(), record.nonce.clone()))
            .collect();
        Self {
            path,
            records,
            request_ids,
            nonces,
            recent_requests: HashMap::new(),
        }
    }

    pub fn check_and_record(&mut self, envelope: &EncryptedEnvelope) -> Result<(), String> {
        let timestamp = DateTime::parse_from_rfc3339(&envelope.timestamp)
            .map_err(|_| "The request timestamp is invalid".to_string())?
            .with_timezone(&Utc);
        let now = Utc::now();
        if timestamp < now - Duration::seconds(WINDOW_SECONDS) {
            return Err("The request timestamp is outside the 30 second window".to_string());
        }
        if timestamp > now + Duration::seconds(FUTURE_TOLERANCE_SECONDS) {
            return Err("The request timestamp is unexpectedly in the future".to_string());
        }

        self.prune(now);
        let request_key = (envelope.client_id.clone(), envelope.request_id.clone());
        if self.request_ids.contains(&request_key) {
            return Err("The requestId has already been used".to_string());
        }
        let nonce_key = (envelope.client_id.clone(), envelope.nonce.clone());
        if self.nonces.contains(&nonce_key) {
            return Err("The nonce has already been used".to_string());
        }

        let rate = self
            .recent_requests
            .entry(envelope.client_id.clone())
            .or_default();
        while rate
            .front()
            .is_some_and(|time| *time < now - Duration::seconds(RATE_WINDOW_SECONDS))
        {
            rate.pop_front();
        }
        if rate.len() >= RATE_LIMIT_PER_CLIENT {
            return Err("This client exceeded the local API rate limit".to_string());
        }
        rate.push_back(now);

        let record = ReplayRecord {
            client_id: envelope.client_id.clone(),
            request_id: envelope.request_id.clone(),
            nonce: envelope.nonce.clone(),
            accepted_at: now.to_rfc3339(),
        };
        self.request_ids.insert(request_key);
        self.nonces.insert(nonce_key);
        self.records.push_back(record);
        while self.records.len() > MAX_RECORDS {
            self.remove_oldest();
        }
        self.persist()
    }

    fn prune(&mut self, now: DateTime<Utc>) {
        let cutoff = now - Duration::seconds(WINDOW_SECONDS * 4);
        loop {
            let expired = self.records.front().is_some_and(|record| {
                DateTime::parse_from_rfc3339(&record.accepted_at)
                    .map(|time| time.with_timezone(&Utc) < cutoff)
                    .unwrap_or(true)
            });
            if !expired {
                break;
            }
            self.remove_oldest();
        }
    }

    fn remove_oldest(&mut self) {
        if let Some(record) = self.records.pop_front() {
            self.request_ids
                .remove(&(record.client_id.clone(), record.request_id));
            self.nonces.remove(&(record.client_id, record.nonce));
        }
    }

    fn persist(&self) -> Result<(), String> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let bytes = serde_json::to_vec(&PersistedReplay {
            records: self.records.iter().cloned().collect(),
        })
        .map_err(|_| "Unable to serialize the replay cache".to_string())?;
        atomic_write(path, &bytes)
    }

    pub fn clear(app: &AppHandle) -> Result<(), String> {
        remove_if_exists(&app_data_dir(app)?.join(REPLAY_FILE))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn envelope() -> EncryptedEnvelope {
        EncryptedEnvelope {
            version: 2,
            instance_id: Uuid::new_v4().to_string(),
            client_id: "client-a".to_string(),
            request_id: Uuid::new_v4().to_string(),
            timestamp: Utc::now().to_rfc3339(),
            route: "/v2/test".to_string(),
            ephemeral_public_key: "public".to_string(),
            nonce: Uuid::new_v4().to_string(),
            ciphertext: "ciphertext".to_string(),
            key_id: None,
        }
    }

    #[test]
    fn duplicate_request_id_and_nonce_are_rejected() {
        let mut guard = ReplayGuard::from_records(None, Vec::new());
        let first = envelope();
        guard.check_and_record(&first).unwrap();
        assert!(guard.check_and_record(&first).is_err());

        let mut same_nonce = envelope();
        same_nonce.nonce = first.nonce;
        assert!(guard.check_and_record(&same_nonce).is_err());
    }

    #[test]
    fn stale_and_future_timestamps_are_rejected() {
        let mut guard = ReplayGuard::from_records(None, Vec::new());
        let mut stale = envelope();
        stale.timestamp = (Utc::now() - Duration::seconds(31)).to_rfc3339();
        assert!(guard.check_and_record(&stale).is_err());
        let mut future = envelope();
        future.timestamp = (Utc::now() + Duration::seconds(6)).to_rfc3339();
        assert!(guard.check_and_record(&future).is_err());
    }
}
