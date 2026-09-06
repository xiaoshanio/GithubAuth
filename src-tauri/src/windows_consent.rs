/* Windows Hello consent gate for destructive whole-vault actions. The OS never
   exposes the account password; the app only learns whether an interactive
   Windows user verified their identity (or that Hello is not usable at all). */
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HelloAvailability {
    Available,
    NotConfigured,
    Unavailable,
}

#[cfg(windows)]
pub fn check_availability() -> Result<HelloAvailability, String> {
    use windows::Security::Credentials::UI::{UserConsentVerifier, UserConsentVerifierAvailability};

    let availability = UserConsentVerifier::CheckAvailabilityAsync()
        .map_err(|error| format!("Unable to query Windows Hello: {error}"))?
        .get()
        .map_err(|error| format!("Unable to query Windows Hello: {error}"))?;
    match availability {
        UserConsentVerifierAvailability::Available => Ok(HelloAvailability::Available),
        UserConsentVerifierAvailability::NotConfiguredForUser
        | UserConsentVerifierAvailability::DisabledByPolicy => Ok(HelloAvailability::NotConfigured),
        _ => Ok(HelloAvailability::Unavailable),
    }
}

#[cfg(windows)]
pub fn request_verification(message: &str) -> Result<bool, String> {
    use windows::Security::Credentials::UI::{UserConsentVerificationResult, UserConsentVerifier};
    use windows::core::HSTRING;

    let result = UserConsentVerifier::RequestVerificationAsync(&HSTRING::from(message))
        .map_err(|error| format!("Unable to start Windows Hello: {error}"))?
        .get()
        .map_err(|error| format!("Windows Hello verification failed: {error}"))?;
    Ok(result == UserConsentVerificationResult::Verified)
}

#[cfg(not(windows))]
pub fn check_availability() -> Result<HelloAvailability, String> {
    // No Hello off-Windows: the caller falls back to the confirmation phrase.
    Ok(HelloAvailability::NotConfigured)
}

#[cfg(not(windows))]
pub fn request_verification(_message: &str) -> Result<bool, String> {
    Err("Windows Hello is only available on Windows".to_string())
}
