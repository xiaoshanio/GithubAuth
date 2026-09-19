use std::net::SocketAddr;

use serde::Serialize;

use super::models::{ClientApplication, PairedClient, LOCAL_API_PORT};

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CallerIdentity {
    pub source_pid: Option<u32>,
    pub executable_path: String,
    pub executable_sha256: String,
    pub authenticode_publisher: String,
    pub signature_status: String,
}

pub fn inspect(remote_address: SocketAddr, application: &ClientApplication) -> CallerIdentity {
    inspect_platform(remote_address).unwrap_or_else(|| CallerIdentity {
        source_pid: None,
        executable_path: application.executable_path.trim().to_string(),
        executable_sha256: String::new(),
        authenticode_publisher: String::new(),
        signature_status: "selfReportedUnverified".to_string(),
    })
}

pub fn inspect_paired(remote_address: SocketAddr, client: &PairedClient) -> CallerIdentity {
    inspect_platform(remote_address).unwrap_or_else(|| CallerIdentity {
        source_pid: None,
        executable_path: client.executable_path.clone(),
        executable_sha256: String::new(),
        authenticode_publisher: String::new(),
        signature_status: "unverified".to_string(),
    })
}

pub fn verified_caller_matches(client: &PairedClient, caller: &CallerIdentity) -> bool {
    if client.signature_status != "verified" {
        return true;
    }
    caller.source_pid.is_some()
        && caller.signature_status == "verified"
        && client
            .executable_path
            .eq_ignore_ascii_case(&caller.executable_path)
        && client.executable_sha256 == caller.executable_sha256
        && client
            .authenticode_publisher
            .eq_ignore_ascii_case(&caller.authenticode_publisher)
}

#[cfg(windows)]
fn inspect_platform(remote_address: SocketAddr) -> Option<CallerIdentity> {
    let pid = pid_for_connection(remote_address.port(), LOCAL_API_PORT)?;
    let path = process_path(pid)?;
    let before = sha256_file(&path)?;
    let (signature_status, publisher) = authenticode(&path);
    let after = sha256_file(&path)?;
    if before != after {
        return None;
    }
    Some(CallerIdentity {
        source_pid: Some(pid),
        executable_path: path.to_string_lossy().into_owned(),
        executable_sha256: before,
        authenticode_publisher: publisher,
        signature_status,
    })
}

#[cfg(not(windows))]
fn inspect_platform(_remote_address: SocketAddr) -> Option<CallerIdentity> {
    None
}

#[cfg(windows)]
fn pid_for_connection(client_port: u16, server_port: u16) -> Option<u32> {
    use windows_sys::Win32::{
        Foundation::{ERROR_INSUFFICIENT_BUFFER, NO_ERROR},
        NetworkManagement::IpHelper::{
            GetExtendedTcpTable, MIB_TCPROW_OWNER_PID, MIB_TCPTABLE_OWNER_PID,
            TCP_TABLE_OWNER_PID_ALL,
        },
        Networking::WinSock::AF_INET,
    };

    let mut size = 0_u32;
    let first = unsafe {
        GetExtendedTcpTable(
            std::ptr::null_mut(),
            &mut size,
            0,
            u32::from(AF_INET),
            TCP_TABLE_OWNER_PID_ALL,
            0,
        )
    };
    if first != ERROR_INSUFFICIENT_BUFFER || size < size_of::<MIB_TCPTABLE_OWNER_PID>() as u32 {
        return None;
    }
    let words = usize::try_from(size).ok()?.div_ceil(size_of::<u32>());
    let mut storage = vec![0_u32; words];
    let status = unsafe {
        GetExtendedTcpTable(
            storage.as_mut_ptr().cast(),
            &mut size,
            0,
            u32::from(AF_INET),
            TCP_TABLE_OWNER_PID_ALL,
            0,
        )
    };
    if status != NO_ERROR {
        return None;
    }
    let table = unsafe { &*(storage.as_ptr().cast::<MIB_TCPTABLE_OWNER_PID>()) };
    let entry_count = usize::try_from(table.dwNumEntries).ok()?;
    let maximum_entries = usize::try_from(size).ok()?.saturating_sub(size_of::<u32>())
        / size_of::<MIB_TCPROW_OWNER_PID>();
    if entry_count > maximum_entries {
        return None;
    }
    let rows = unsafe { std::slice::from_raw_parts(table.table.as_ptr(), entry_count) };
    rows.iter()
        .find(|row: &&MIB_TCPROW_OWNER_PID| {
            u16::from_be(row.dwLocalPort as u16) == client_port
                && u16::from_be(row.dwRemotePort as u16) == server_port
        })
        .map(|row| row.dwOwningPid)
}

#[cfg(windows)]
fn process_path(pid: u32) -> Option<std::path::PathBuf> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, FALSE},
        System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
        },
    };

    let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid) };
    if process.is_null() {
        return None;
    }
    let mut buffer = vec![0_u16; 32_768];
    let mut length = buffer.len() as u32;
    let ok = unsafe { QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length) };
    unsafe { CloseHandle(process) };
    if ok == 0 || length == 0 {
        return None;
    }
    buffer.truncate(length as usize);
    Some(std::path::PathBuf::from(String::from_utf16(&buffer).ok()?))
}

#[cfg(windows)]
fn sha256_file(path: &std::path::Path) -> Option<String> {
    use std::io::Read;

    use sha2::{Digest, Sha256};

    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > 1024 * 1024 * 1024 {
        return None;
    }
    let mut file = std::fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).ok()?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Some(data_encoding::HEXLOWER.encode(&hasher.finalize()))
}

#[cfg(windows)]
fn authenticode(path: &std::path::Path) -> (String, String) {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::{
        Foundation::{HWND, TRUST_E_NOSIGNATURE},
        Security::WinTrust::{
            WinVerifyTrust, WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_DATA_0,
            WINTRUST_FILE_INFO, WTD_CACHE_ONLY_URL_RETRIEVAL, WTD_CHOICE_FILE,
            WTD_REVOCATION_CHECK_NONE, WTD_REVOKE_NONE, WTD_STATEACTION_CLOSE,
            WTD_STATEACTION_VERIFY, WTD_UICONTEXT_EXECUTE, WTD_UI_NONE,
        },
    };

    let wide_path = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let mut file_info = WINTRUST_FILE_INFO {
        cbStruct: size_of::<WINTRUST_FILE_INFO>() as u32,
        pcwszFilePath: wide_path.as_ptr(),
        hFile: std::ptr::null_mut(),
        pgKnownSubject: std::ptr::null_mut(),
    };
    let mut trust_data = WINTRUST_DATA {
        cbStruct: size_of::<WINTRUST_DATA>() as u32,
        pPolicyCallbackData: std::ptr::null_mut(),
        pSIPClientData: std::ptr::null_mut(),
        dwUIChoice: WTD_UI_NONE,
        fdwRevocationChecks: WTD_REVOKE_NONE,
        dwUnionChoice: WTD_CHOICE_FILE,
        Anonymous: WINTRUST_DATA_0 {
            pFile: &mut file_info,
        },
        dwStateAction: WTD_STATEACTION_VERIFY,
        hWVTStateData: std::ptr::null_mut(),
        pwszURLReference: std::ptr::null_mut(),
        dwProvFlags: WTD_CACHE_ONLY_URL_RETRIEVAL | WTD_REVOCATION_CHECK_NONE,
        dwUIContext: WTD_UICONTEXT_EXECUTE,
        pSignatureSettings: std::ptr::null_mut(),
    };
    let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    let result = unsafe {
        WinVerifyTrust(
            std::ptr::null_mut::<core::ffi::c_void>() as HWND,
            &mut action,
            (&mut trust_data as *mut WINTRUST_DATA).cast(),
        )
    };
    let publisher = if result == 0 {
        publisher_from_state(trust_data.hWVTStateData)
    } else {
        String::new()
    };
    if !trust_data.hWVTStateData.is_null() {
        trust_data.dwStateAction = WTD_STATEACTION_CLOSE;
        unsafe {
            WinVerifyTrust(
                std::ptr::null_mut::<core::ffi::c_void>() as HWND,
                &mut action,
                (&mut trust_data as *mut WINTRUST_DATA).cast(),
            )
        };
    }
    if result == 0 && !publisher.is_empty() {
        ("verified".to_string(), publisher)
    } else if result == TRUST_E_NOSIGNATURE {
        ("unsigned".to_string(), String::new())
    } else {
        ("invalidOrUnverified".to_string(), String::new())
    }
}

#[cfg(windows)]
fn publisher_from_state(state: *mut core::ffi::c_void) -> String {
    use windows_sys::Win32::Security::{
        Cryptography::{CertGetNameStringW, CERT_NAME_SIMPLE_DISPLAY_TYPE},
        WinTrust::{
            WTHelperGetProvCertFromChain, WTHelperGetProvSignerFromChain,
            WTHelperProvDataFromStateData,
        },
    };

    let provider = unsafe { WTHelperProvDataFromStateData(state) };
    if provider.is_null() {
        return String::new();
    }
    let signer = unsafe { WTHelperGetProvSignerFromChain(provider, 0, 0, 0) };
    if signer.is_null() {
        return String::new();
    }
    let provider_cert = unsafe { WTHelperGetProvCertFromChain(signer, 0) };
    if provider_cert.is_null() || unsafe { (*provider_cert).pCert.is_null() } {
        return String::new();
    }
    let cert = unsafe { (*provider_cert).pCert };
    let length = unsafe {
        CertGetNameStringW(
            cert,
            CERT_NAME_SIMPLE_DISPLAY_TYPE,
            0,
            std::ptr::null(),
            std::ptr::null_mut(),
            0,
        )
    };
    if length <= 1 {
        return String::new();
    }
    let mut buffer = vec![0_u16; length as usize];
    let written = unsafe {
        CertGetNameStringW(
            cert,
            CERT_NAME_SIMPLE_DISPLAY_TYPE,
            0,
            std::ptr::null(),
            buffer.as_mut_ptr(),
            length,
        )
    };
    if written <= 1 {
        return String::new();
    }
    buffer.truncate((written - 1) as usize);
    String::from_utf16(&buffer).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client(status: &str) -> PairedClient {
        PairedClient {
            id: "client".to_string(),
            application_name: "App".to_string(),
            developer: "Dev".to_string(),
            description: "Purpose".to_string(),
            icon: "https://example.com/icon.png".to_string(),
            certificate_fingerprint: "a".repeat(64),
            encryption_public_key: "b".repeat(44),
            executable_path: "C:\\app.exe".to_string(),
            executable_sha256: "hash".to_string(),
            authenticode_publisher: "Publisher".to_string(),
            signature_status: status.to_string(),
            allow_import: true,
            allow_read: true,
            group_id: None,
            enabled: true,
            created_at: "2026-09-19T00:00:00Z".to_string(),
            expires_at: "2026-12-19T00:00:00Z".to_string(),
            last_used_at: None,
        }
    }

    #[test]
    fn verified_client_requires_the_same_binary_identity() {
        let client = client("verified");
        let exact = CallerIdentity {
            source_pid: Some(123),
            executable_path: "c:\\APP.exe".to_string(),
            executable_sha256: "hash".to_string(),
            authenticode_publisher: "publisher".to_string(),
            signature_status: "verified".to_string(),
        };
        assert!(verified_caller_matches(&client, &exact));
        let mut changed = exact.clone();
        changed.executable_sha256 = "different".to_string();
        assert!(!verified_caller_matches(&client, &changed));
    }

    #[test]
    fn unverified_client_is_not_falsely_promoted_to_verified() {
        let client = client("selfReportedUnverified");
        assert!(verified_caller_matches(&client, &CallerIdentity::default()));
    }

    #[cfg(windows)]
    #[test]
    fn resolves_the_process_owning_a_live_loopback_connection() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let server_address = listener.local_addr().unwrap();
        let client = std::net::TcpStream::connect(server_address).unwrap();
        let (_server, peer_address) = listener.accept().unwrap();
        let pid = pid_for_connection(peer_address.port(), server_address.port()).unwrap();
        assert_eq!(pid, std::process::id());
        let path = process_path(pid).unwrap();
        assert!(!path.as_os_str().is_empty());
        assert_eq!(sha256_file(&path).unwrap().len(), 64);
        let (status, publisher) = authenticode(&path);
        assert!(["verified", "unsigned", "invalidOrUnverified"].contains(&status.as_str()));
        if status == "verified" {
            assert!(!publisher.is_empty());
        }
        drop(client);
    }
}
