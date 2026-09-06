# Github Auth

Local encrypted GitHub account vault packaged for Windows with Tauri 2.

**Read this in other languages:** [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [Русский](README.ru.md) · [Français](README.fr.md) · [Tiếng Việt](README.vi.md) · [한국어](README.ko.md)

## Interface languages

The app ships with 13 interface languages: Simplified Chinese, Traditional Chinese, English, Japanese, Korean, Russian, French, Vietnamese, Spanish, Italian, Portuguese, Finnish, and Filipino. On first launch the interface follows the operating system language; the language can be changed at any time in Vault settings, and the choice is remembered.

## Requirements

- Windows 10 or Windows 11
- Node.js and pnpm
- Rust stable with the `x86_64-pc-windows-msvc` target
- Microsoft C++ Build Tools
- Microsoft Edge WebView2 Runtime

## Development

```powershell
pnpm install
pnpm tauri:dev
```

## Build

```powershell
pnpm tauri:build
```

Build outputs:

- Portable executable: `src-tauri/target/release/github-auth.exe`
- NSIS installer: `src-tauri/target/release/bundle/nsis/Github Auth_1.0.0_x64-setup.exe`

The installer opens a language selector with English and Simplified Chinese, and uses the application LOGO for the installer, uninstaller, executable, and shortcuts.

## Security

- Vault format v2 encrypts the complete payload with a random 256-bit data key and AES-256-GCM.
- The master password is processed by Argon2id (64 MiB, 3 iterations, parallelism 1) with a random salt. The derived key wraps the data key; it does not directly encrypt account records.
- Every payload write and password-key wrap uses a fresh 96-bit AES-GCM nonce and purpose-specific authenticated data.
- Envelopes, payloads, backup containers, KDF limits, record IDs, and group references are validated by the Rust backend before use.
- Vault files are replaced atomically with write-through semantics on Windows. The application is single-instance to prevent concurrent vault writes.
- Version 1 PBKDF2-SHA-256 vault files are migrated to v2 only after the old password successfully decrypts and authenticates the complete payload.
- Passwords, decrypted payloads, and encryption keys are not written to application logs. Sensitive Rust buffers are cleared on drop where practical.
- An envelope or backup that would exceed the readable size limit is rejected before anything is written, so an oversized payload can never replace a good vault file with an unreadable one.
- Avatar URLs stored in the vault must use an `https` origin and are length-bounded, alongside every other account field, before a payload is accepted.
- The window is undecorated and its chrome is drawn by the application. The webview is granted exactly five window permissions (`start-dragging`, `minimize`, `toggle-maximize`, `is-maximized`, `close`) scoped to the `main` window; no filesystem, shell, path, or event permissions are exposed, and vault access stays behind the application's own commands.

### Authenticator quick unlock

Google Authenticator quick unlock uses a standard 6-digit, 30-second TOTP. The TOTP secret and vault data key are protected by Windows DPAPI for the current Windows user and bound to the vault ID. Successful time steps cannot be replayed, and repeated failures trigger an exponential cooldown.

Quick unlock is a device-bound convenience feature, not a portable second encryption password. The master password always remains available and is the only credential that can decrypt a backup on another device. The quick-unlock binding is never included in backups.

## Encrypted backups

- Manual backups use the `.ghauth-backup` format and are written through the Rust backend.
- Automatic backups run only while Github Auth is open, including while the vault is locked. Supported intervals are 6 hours, 12 hours, daily, and weekly.
- The default automatic backup directory is `%LOCALAPPDATA%\com.githubauth.vault\backups`; the directory and retention count can be changed in Vault settings.
- A backup uses the master password that was active when that backup was created. Changing the current master password does not change older backups.
- Import first requires the backup's original password. Adding data or placing it in a dated backup group preserves the current vault settings.
- Replacing current data always requires the current vault password as a separate authorization step. The user can create a current-password-protected backup before replacement.
- Imported data is re-encrypted with the current vault's data key and current master-password wrapper. Import never changes the current password or Authenticator binding.

The encrypted envelope is stored under `%LOCALAPPDATA%\com.githubauth.vault`. Production builds exclude the former Manus runtime, debug collector, and storage proxy.

Run the security tests with:

```powershell
pnpm test:security
cargo test --manifest-path src-tauri/Cargo.toml
```

Release builds are unsigned until a Windows code-signing certificate is configured. Unsigned installers can trigger Microsoft Defender SmartScreen warnings.
