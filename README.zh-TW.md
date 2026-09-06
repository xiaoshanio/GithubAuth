# Github Auth

以 Tauri 2 封裝的 Windows 本機加密 GitHub 帳戶保險庫。

**以其他語言閱讀：** [简体中文](README.zh-CN.md) · [English](README.md) · **繁體中文** · [日本語](README.ja.md) · [Русский](README.ru.md) · [Français](README.fr.md) · [Tiếng Việt](README.vi.md) · [한국어](README.ko.md)

## 介面語言

應用程式內建 13 種介面語言：简体中文、繁體中文、English、日本語、한국어、Русский、Français、Tiếng Việt、Español、Italiano、Português、Suomi、Filipino。首次啟動時，介面會跟隨作業系統語言；之後可以隨時在保險庫設定中變更語言，且系統會記住該選擇。

## 系統需求

- Windows 10 或 Windows 11
- Node.js 與 pnpm
- Rust stable（含 `x86_64-pc-windows-msvc` 目標）
- Microsoft C++ Build Tools
- Microsoft Edge WebView2 Runtime

## 開發

```powershell
pnpm install
pnpm tauri:dev
```

## 建置

```powershell
pnpm tauri:build
```

建置產出：

- 可攜式可執行檔：`src-tauri/target/release/github-auth.exe`
- NSIS 安裝程式：`src-tauri/target/release/bundle/nsis/Github Auth_1.0.0_x64-setup.exe`

安裝程式會開啟一個包含英文與简体中文的語言選擇器，且安裝程式、解除安裝程式、可執行檔與捷徑均使用應用程式 LOGO。

## 安全性

- 保險庫格式 v2 使用隨機的 256 位元資料金鑰與 AES-256-GCM 加密完整承載資料。
- 主密碼經 Argon2id（64 MiB、3 次迭代、平行度 1）處理，並使用隨機鹽值。衍生的金鑰用於封裝資料金鑰，而非直接加密帳戶記錄。
- 每次寫入承載資料與封裝密碼金鑰時，都會使用全新的 96 位元 AES-GCM nonce 以及特定用途的驗證資料。
- 信封、承載資料、備份容器、KDF 限制、記錄 ID 與群組參考，在使用前皆由 Rust 後端進行驗證。
- 在 Windows 上，保險庫檔案以 write-through 語意進行原子式替換。應用程式為單一執行個體執行，以防止並發寫入保險庫。
- 版本 1 的 PBKDF2-SHA-256 保險庫檔案，只有在舊密碼成功解密並通過完整承載資料驗證後，才會遷移至 v2。
- 密碼、解密後的承載資料與加密金鑰不會寫入應用程式記錄。在可行的情況下，敏感的 Rust 緩衝區會在釋放時清空。
- 超過可讀取大小限制的信封或備份，會在寫入任何內容之前被拒絕，因此過大的承載資料絕不會把完好的保險庫檔案取代成無法讀取的檔案。
- 儲存在保險庫中的大頭貼 URL 必須使用 `https` 來源，並與其他所有帳戶欄位一樣受到長度限制，之後承載資料才會被接受。
- 視窗無邊框，其介面外框由應用程式自行繪製。Webview 僅被授予確切五個視窗權限（`start-dragging`、`minimize`、`toggle-maximize`、`is-maximized`、`close`），且範圍限定於 `main` 視窗；不會暴露任何檔案系統、shell、路徑或事件權限，保險庫存取一律經由應用程式自身的命令處理。

### 驗證器快速解鎖

Google Authenticator 快速解鎖採用標準的 6 位數、30 秒週期的 TOTP。TOTP 密鑰與保險庫資料金鑰由 Windows DPAPI 保護，適用於目前的 Windows 使用者，並繫結至保險庫 ID。已成功的時間步無法重放，重複失敗會觸發指數退避冷卻。

快速解鎖是一項與裝置綁定的便利功能，而非可攜的第二組加密密碼。主密碼始終可用，且是唯一能在其他裝置上解密備份的憑證。快速解鎖的綁定資訊絕不會包含在備份中。

## 加密備份

- 手動備份使用 `.ghauth-backup` 格式，並透過 Rust 後端寫入。
- 自動備份僅在 Github Auth 開啟時執行，包括保險庫處於鎖定狀態時。支援的間隔為 6 小時、12 小時、每天與每週。
- 預設的自動備份目錄為 `%LOCALAPPDATA%\com.githubauth.vault\backups`；目錄與保留數量可在保險庫設定中變更。
- 備份使用建立該備份當時生效的主密碼。變更目前的主密碼不會影響較舊的備份。
- 匯入首先需要該備份的原始密碼。新增資料或將其放入帶日期的備份群組，會保留目前的保險庫設定。
- 取代目前資料一律需要目前保險庫密碼作為單獨的授權步驟。使用者可以在取代前建立一個受目前密碼保護的備份。
- 匯入的資料會以目前保險庫的資料金鑰與目前主密碼封裝器重新加密。匯入絕不會變更目前的密碼或驗證器綁定。

加密信封儲存在 `%LOCALAPPDATA%\com.githubauth.vault` 之下。正式版本組建已移除先前的 Manus 執行階段、偵錯收集器與儲存代理。

執行安全性測試：

```powershell
pnpm test:security
cargo test --manifest-path src-tauri/Cargo.toml
```

在設定 Windows 程式碼簽署憑證之前，正式版本組建皆為未簽署狀態。未簽署的安裝程式可能會觸發 Microsoft Defender SmartScreen 警告。
