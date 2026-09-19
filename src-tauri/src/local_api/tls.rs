use std::{net::SocketAddr, sync::Arc};

use rustls::{
    pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer},
    server::WebPkiClientVerifier,
    RootCertStore, ServerConfig,
};
use tokio_rustls::server::TlsStream;

use super::identity::{certificate_fingerprint, LocalIdentity};

#[derive(Clone)]
pub struct ConnectionInfo {
    pub remote_address: SocketAddr,
    pub certificate_fingerprint: Option<String>,
}

pub fn server_config(identity: &LocalIdentity) -> Result<Arc<ServerConfig>, String> {
    server_config_from_der(
        identity.ca_cert_der(),
        identity.server_cert_der(),
        identity.server_key_der(),
    )
}

fn server_config_from_der(
    ca_cert_der: &[u8],
    server_cert_der: &[u8],
    server_key_der: &[u8],
) -> Result<Arc<ServerConfig>, String> {
    let mut roots = RootCertStore::empty();
    roots
        .add(CertificateDer::from(ca_cert_der.to_vec()))
        .map_err(|_| "Unable to load the local client CA certificate".to_string())?;
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let verifier = WebPkiClientVerifier::builder_with_provider(Arc::new(roots), provider.clone())
        .allow_unauthenticated()
        .build()
        .map_err(|_| "Unable to configure local client certificate verification".to_string())?;
    let mut config = ServerConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS13])
        .map_err(|_| "Unable to require TLS 1.3".to_string())?
        .with_client_cert_verifier(verifier)
        .with_single_cert(
            vec![CertificateDer::from(server_cert_der.to_vec())],
            PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(server_key_der.to_vec())),
        )
        .map_err(|_| "Unable to configure the local TLS certificate".to_string())?;
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(Arc::new(config))
}

pub fn connection_info(
    stream: &TlsStream<tokio::net::TcpStream>,
    remote_address: SocketAddr,
) -> ConnectionInfo {
    let certificate_fingerprint = stream
        .get_ref()
        .1
        .peer_certificates()
        .and_then(|certificates| certificates.first())
        .map(|certificate| certificate_fingerprint(certificate.as_ref()));
    ConnectionInfo {
        remote_address,
        certificate_fingerprint,
    }
}

#[cfg(test)]
mod tests {
    use std::{io::Cursor, sync::Arc};

    use rcgen::{
        BasicConstraints, CertificateParams, DistinguishedName, DnType, IsCa, Issuer, KeyPair,
        KeyUsagePurpose,
    };
    use rustls::{
        pki_types::{CertificateDer, ServerName},
        ClientConfig, ClientConnection, RootCertStore, ServerConnection,
    };

    use super::*;

    fn test_material() -> (Vec<u8>, Vec<u8>, Vec<u8>) {
        let ca_key = KeyPair::generate().unwrap();
        let mut ca_params = CertificateParams::default();
        let mut ca_name = DistinguishedName::new();
        ca_name.push(DnType::CommonName, "Test CA");
        ca_params.distinguished_name = ca_name;
        ca_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        ca_params.key_usages = vec![KeyUsagePurpose::KeyCertSign];
        let ca_cert = ca_params.self_signed(&ca_key).unwrap();

        let server_key = KeyPair::generate().unwrap();
        let server_params = CertificateParams::new(vec!["127.0.0.1".to_string()]).unwrap();
        let issuer = Issuer::new(ca_params, &ca_key);
        let server_cert = server_params.signed_by(&server_key, &issuer).unwrap();
        (
            ca_cert.der().to_vec(),
            server_cert.der().to_vec(),
            server_key.serialize_der(),
        )
    }

    fn client_config(
        ca: &[u8],
        version: &'static rustls::SupportedProtocolVersion,
    ) -> ClientConfig {
        let mut roots = RootCertStore::empty();
        roots.add(CertificateDer::from(ca.to_vec())).unwrap();
        ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
            .with_protocol_versions(&[version])
            .unwrap()
            .with_root_certificates(roots)
            .with_no_client_auth()
    }

    fn handshake(
        client_config: ClientConfig,
        server_config: Arc<ServerConfig>,
    ) -> Result<(), String> {
        let name = ServerName::try_from("127.0.0.1").unwrap().to_owned();
        let mut client = ClientConnection::new(Arc::new(client_config), name).unwrap();
        let mut server = ServerConnection::new(server_config).unwrap();
        for _ in 0..10 {
            let mut client_bytes = Vec::new();
            client.write_tls(&mut client_bytes).unwrap();
            if !client_bytes.is_empty() {
                server
                    .read_tls(&mut Cursor::new(client_bytes))
                    .map_err(|error| error.to_string())?;
                server
                    .process_new_packets()
                    .map_err(|error| error.to_string())?;
            }
            let mut server_bytes = Vec::new();
            server.write_tls(&mut server_bytes).unwrap();
            if !server_bytes.is_empty() {
                client
                    .read_tls(&mut Cursor::new(server_bytes))
                    .map_err(|error| error.to_string())?;
                client
                    .process_new_packets()
                    .map_err(|error| error.to_string())?;
            }
            if !client.is_handshaking() && !server.is_handshaking() {
                return Ok(());
            }
        }
        Err("handshake did not finish".to_string())
    }

    #[test]
    fn tls13_succeeds_and_tls12_is_rejected() {
        let (ca, cert, key) = test_material();
        let server = server_config_from_der(&ca, &cert, &key).unwrap();
        assert!(handshake(client_config(&ca, &rustls::version::TLS13), server.clone()).is_ok());
        assert!(handshake(client_config(&ca, &rustls::version::TLS12), server).is_err());
    }

    #[test]
    fn an_untrusted_server_certificate_is_rejected() {
        let (ca, cert, key) = test_material();
        let (wrong_ca, _, _) = test_material();
        let server = server_config_from_der(&ca, &cert, &key).unwrap();
        assert!(handshake(client_config(&wrong_ca, &rustls::version::TLS13), server).is_err());
    }
}
