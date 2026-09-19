use base64::{engine::general_purpose::STANDARD, Engine as _};
use chacha20poly1305::{
    aead::{Aead, Payload},
    ChaCha20Poly1305, KeyInit, Nonce,
};
use chrono::Utc;
use hkdf::Hkdf;
use rand::{rngs::OsRng, RngCore};
use serde::{de::DeserializeOwned, Serialize};
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::{Zeroize, Zeroizing};

use super::models::{EncryptedEnvelope, PROTOCOL_VERSION};

const KDF_LABEL: &[u8] = b"github-auth-local-api:v2";

pub fn decrypt_request<T: DeserializeOwned>(
    envelope: &EncryptedEnvelope,
    expected_instance_id: &str,
    expected_route: &str,
    server_secret: [u8; 32],
) -> Result<T, String> {
    validate_metadata(envelope, expected_instance_id, expected_route)?;
    let peer_public = decode_array::<32>(&envelope.ephemeral_public_key, "ephemeral public key")?;
    let secret = StaticSecret::from(server_secret);
    let exchange = secret.diffie_hellman(&PublicKey::from(peer_public));
    if !exchange.was_contributory() {
        return Err("The ephemeral X25519 public key is invalid".to_string());
    }
    let shared = Zeroizing::new(exchange.to_bytes());
    decrypt_with_shared(envelope, shared.as_ref())
}

pub fn encrypt_response<T: Serialize>(
    payload: &T,
    instance_id: &str,
    client_id: &str,
    request_id: &str,
    route: &str,
    client_public_key: [u8; 32],
) -> Result<EncryptedEnvelope, String> {
    let ephemeral = StaticSecret::random_from_rng(OsRng);
    let ephemeral_public = PublicKey::from(&ephemeral);
    let exchange = ephemeral.diffie_hellman(&PublicKey::from(client_public_key));
    if !exchange.was_contributory() {
        return Err("The client X25519 public key is invalid".to_string());
    }
    let shared = Zeroizing::new(exchange.to_bytes());
    let mut nonce = [0_u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let mut envelope = EncryptedEnvelope {
        version: PROTOCOL_VERSION,
        instance_id: instance_id.to_string(),
        client_id: client_id.to_string(),
        request_id: request_id.to_string(),
        timestamp: Utc::now().to_rfc3339(),
        route: route.to_string(),
        ephemeral_public_key: STANDARD.encode(ephemeral_public.as_bytes()),
        nonce: STANDARD.encode(nonce),
        ciphertext: String::new(),
        key_id: None,
    };
    let key = derive_message_key(
        shared.as_ref(),
        &envelope.instance_id,
        &envelope.client_id,
        &envelope.route,
        &envelope.request_id,
    )?;
    let plaintext = Zeroizing::new(
        serde_json::to_vec(payload).map_err(|_| "Unable to serialize encrypted response")?,
    );
    let aad = aad(&envelope)?;
    let cipher = ChaCha20Poly1305::new_from_slice(key.as_ref())
        .map_err(|_| "Unable to initialize response encryption")?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &plaintext,
                aad: &aad,
            },
        )
        .map_err(|_| "Unable to encrypt the response")?;
    envelope.ciphertext = STANDARD.encode(ciphertext);
    Ok(envelope)
}

fn decrypt_with_shared<T: DeserializeOwned>(
    envelope: &EncryptedEnvelope,
    shared: &[u8],
) -> Result<T, String> {
    let nonce = decode_array::<12>(&envelope.nonce, "nonce")?;
    let ciphertext = STANDARD
        .decode(&envelope.ciphertext)
        .map_err(|_| "The encrypted request body is invalid")?;
    if ciphertext.len() < 16 || ciphertext.len() > super::models::MAX_REQUEST_BYTES {
        return Err("The encrypted request body has an invalid size".to_string());
    }
    let key = derive_message_key(
        shared,
        &envelope.instance_id,
        &envelope.client_id,
        &envelope.route,
        &envelope.request_id,
    )?;
    let aad = aad(envelope)?;
    let cipher = ChaCha20Poly1305::new_from_slice(key.as_ref())
        .map_err(|_| "Unable to initialize request decryption")?;
    let mut plaintext = Zeroizing::new(
        cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &ciphertext,
                    aad: &aad,
                },
            )
            .map_err(|_| "The encrypted request failed authentication")?,
    );
    let value =
        serde_json::from_slice(&plaintext).map_err(|_| "The decrypted request body is invalid")?;
    plaintext.zeroize();
    Ok(value)
}

fn validate_metadata(
    envelope: &EncryptedEnvelope,
    instance_id: &str,
    route: &str,
) -> Result<(), String> {
    if envelope.version != PROTOCOL_VERSION
        || envelope.instance_id != instance_id
        || envelope.route != route
        || envelope.client_id.len() > 128
        || envelope.request_id.len() > 128
    {
        return Err("The encrypted envelope metadata does not match this service".to_string());
    }
    uuid::Uuid::parse_str(&envelope.request_id)
        .map_err(|_| "requestId must be a random UUID".to_string())?;
    Ok(())
}

fn aad(envelope: &EncryptedEnvelope) -> Result<Vec<u8>, String> {
    serde_json::to_vec(&(
        envelope.version,
        envelope.instance_id.as_str(),
        envelope.client_id.as_str(),
        envelope.request_id.as_str(),
        envelope.timestamp.as_str(),
        envelope.route.as_str(),
        envelope.ephemeral_public_key.as_str(),
    ))
    .map_err(|_| "Unable to authenticate the request metadata".to_string())
}

fn derive_message_key(
    shared: &[u8],
    instance_id: &str,
    client_id: &str,
    route: &str,
    request_id: &str,
) -> Result<Zeroizing<[u8; 32]>, String> {
    let mut salt_input =
        Zeroizing::new(Vec::with_capacity(instance_id.len() + client_id.len() + 1));
    salt_input.extend_from_slice(instance_id.as_bytes());
    salt_input.push(0);
    salt_input.extend_from_slice(client_id.as_bytes());
    let salt = Sha256::digest(&*salt_input);
    let mut info = Zeroizing::new(Vec::with_capacity(route.len() + request_id.len() + 32));
    info.extend_from_slice(KDF_LABEL);
    info.push(0);
    info.extend_from_slice(route.as_bytes());
    info.push(0);
    info.extend_from_slice(request_id.as_bytes());
    let hkdf = Hkdf::<Sha256>::new(Some(&salt), shared);
    let mut key = Zeroizing::new([0_u8; 32]);
    hkdf.expand(&info, key.as_mut())
        .map_err(|_| "Unable to derive the message key".to_string())?;
    Ok(key)
}

pub fn decode_x25519_public(value: &str) -> Result<[u8; 32], String> {
    decode_array::<32>(value, "X25519 public key")
}

fn decode_array<const N: usize>(value: &str, field: &str) -> Result<[u8; N], String> {
    let bytes = STANDARD
        .decode(value)
        .map_err(|_| format!("The {field} is not valid base64"))?;
    bytes
        .as_slice()
        .try_into()
        .map_err(|_| format!("The {field} has the wrong length"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };

    #[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
    struct SecretBody {
        password: String,
    }

    struct ZeroizeProbe(Arc<AtomicBool>);

    impl Zeroize for ZeroizeProbe {
        fn zeroize(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    fn request_envelope(
        body: &SecretBody,
        server_public: PublicKey,
        request_id: &str,
        route: &str,
    ) -> EncryptedEnvelope {
        let client_ephemeral = StaticSecret::random_from_rng(OsRng);
        let ephemeral_public = PublicKey::from(&client_ephemeral);
        let shared = client_ephemeral.diffie_hellman(&server_public).to_bytes();
        let mut nonce = [0_u8; 12];
        OsRng.fill_bytes(&mut nonce);
        let mut envelope = EncryptedEnvelope {
            version: 2,
            instance_id: "4f2d55f6-960e-4e5b-b1c8-cba5f9f44440".to_string(),
            client_id: "client-a".to_string(),
            request_id: request_id.to_string(),
            timestamp: "2026-09-19T00:00:00Z".to_string(),
            route: route.to_string(),
            ephemeral_public_key: STANDARD.encode(ephemeral_public.as_bytes()),
            nonce: STANDARD.encode(nonce),
            ciphertext: String::new(),
            key_id: None,
        };
        let key = derive_message_key(
            &shared,
            &envelope.instance_id,
            &envelope.client_id,
            &envelope.route,
            &envelope.request_id,
        )
        .unwrap();
        let cipher = ChaCha20Poly1305::new_from_slice(key.as_ref()).unwrap();
        envelope.ciphertext = STANDARD.encode(
            cipher
                .encrypt(
                    Nonce::from_slice(&nonce),
                    Payload {
                        msg: &serde_json::to_vec(body).unwrap(),
                        aad: &aad(&envelope).unwrap(),
                    },
                )
                .unwrap(),
        );
        envelope
    }

    #[test]
    fn x25519_both_sides_derive_the_same_secret() {
        let left = StaticSecret::random_from_rng(OsRng);
        let right = StaticSecret::random_from_rng(OsRng);
        assert_eq!(
            left.diffie_hellman(&PublicKey::from(&right)).as_bytes(),
            right.diffie_hellman(&PublicKey::from(&left)).as_bytes()
        );
    }

    #[test]
    fn request_id_and_route_are_bound_into_the_key() {
        let shared = [7_u8; 32];
        let first =
            derive_message_key(&shared, "instance", "client", "/v2/a", "request-a").unwrap();
        let different_request =
            derive_message_key(&shared, "instance", "client", "/v2/a", "request-b").unwrap();
        let different_route =
            derive_message_key(&shared, "instance", "client", "/v2/b", "request-a").unwrap();
        assert_ne!(*first, *different_request);
        assert_ne!(*first, *different_route);
    }

    #[test]
    fn aad_ciphertext_and_nonce_tampering_are_rejected() {
        let server = StaticSecret::random_from_rng(OsRng);
        let public = PublicKey::from(&server);
        let body = SecretBody {
            password: "correct horse battery staple".to_string(),
        };
        let request_id = uuid::Uuid::new_v4().to_string();
        let envelope = request_envelope(&body, public, &request_id, "/v2/test");
        let wire_json = serde_json::to_string(&envelope).unwrap();
        assert!(!wire_json.contains("correct horse battery staple"));
        let decrypted: SecretBody = decrypt_request(
            &envelope,
            &envelope.instance_id,
            "/v2/test",
            server.to_bytes(),
        )
        .unwrap();
        assert_eq!(decrypted, body);

        let mut aad_changed = envelope.clone();
        aad_changed.timestamp = "2026-09-19T00:00:01Z".to_string();
        assert!(decrypt_request::<SecretBody>(
            &aad_changed,
            &aad_changed.instance_id,
            "/v2/test",
            server.to_bytes()
        )
        .is_err());

        let mut ciphertext_changed = envelope.clone();
        let mut ciphertext = STANDARD.decode(&ciphertext_changed.ciphertext).unwrap();
        ciphertext[0] ^= 1;
        ciphertext_changed.ciphertext = STANDARD.encode(ciphertext);
        assert!(decrypt_request::<SecretBody>(
            &ciphertext_changed,
            &ciphertext_changed.instance_id,
            "/v2/test",
            server.to_bytes()
        )
        .is_err());

        let mut nonce_changed = envelope.clone();
        let mut nonce = STANDARD.decode(&nonce_changed.nonce).unwrap();
        nonce[0] ^= 1;
        nonce_changed.nonce = STANDARD.encode(nonce);
        assert!(decrypt_request::<SecretBody>(
            &nonce_changed,
            &nonce_changed.instance_id,
            "/v2/test",
            server.to_bytes()
        )
        .is_err());
    }

    #[test]
    fn zeroizing_clears_wrapped_secret_on_scope_exit() {
        let cleared = Arc::new(AtomicBool::new(false));
        {
            let _secret = Zeroizing::new(ZeroizeProbe(cleared.clone()));
        }
        assert!(cleared.load(Ordering::SeqCst));
    }
}
