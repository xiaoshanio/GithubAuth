# Github Auth

基于 Tauri 2 打包的 Windows 本地加密 GitHub 账户保险库。

**阅读其他语言版本：** **简体中文** · [English](README.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [Русский](README.ru.md) · [Français](README.fr.md) · [Tiếng Việt](README.vi.md) · [한국어](README.ko.md)

## 界面语言

应用内置 13 种界面语言：简体中文、繁體中文、English、日本語、한국어、Русский、Français、Tiếng Việt、Español、Italiano、Português、Suomi、Filipino。首次启动时，界面会跟随操作系统语言；之后可以随时在保险库设置中更改语言，并且会记住该选择。

## 环境要求

- Windows 10 或 Windows 11
- Node.js 和 pnpm
- Rust stable（含 `x86_64-pc-windows-msvc` 目标）
- Microsoft C++ Build Tools
- Microsoft Edge WebView2 Runtime

## 开发

```powershell
pnpm install
pnpm tauri:dev
```

## 构建

```powershell
pnpm tauri:build
```

构建产物：

- 便携版可执行文件：`src-tauri/target/release/github-auth.exe`
- NSIS 安装程序：`src-tauri/target/release/bundle/nsis/Github Auth_1.0.0_x64-setup.exe`

安装程序会打开一个包含英文和简体中文的语言选择器，并且安装程序、卸载程序、可执行文件和快捷方式均使用应用 LOGO。

## 安全性

- 保险库格式 v2 使用随机的 256 位数据密钥和 AES-256-GCM 对完整载荷进行加密。
- 主密码经 Argon2id（64 MiB、3 次迭代、并行度 1）处理，并使用随机盐值。派生密钥用于封装数据密钥，而不是直接加密账户记录。
- 每次写入载荷和封装密码密钥时，都会使用全新的 96 位 AES-GCM nonce 以及特定用途的认证数据。
- 信封、载荷、备份容器、KDF 限制、记录 ID 和分组引用在使用前都会由 Rust 后端进行校验。
- 在 Windows 上，保险库文件以直写（write-through）语义原子性地替换。应用为单实例运行，以防止并发写入保险库。
- 版本 1 的 PBKDF2-SHA-256 保险库文件只有在旧密码成功解密并通过完整载荷认证后，才会迁移到 v2。
- 密码、解密后的载荷和加密密钥不会写入应用日志。在可行的情况下，敏感的 Rust 缓冲区会在释放时被清零。
- 超出可读取大小限制的信封或备份会在写入任何内容之前被拒绝，因此过大的载荷永远不会把完好的保险库文件替换成无法读取的文件。
- 保险库中存储的头像 URL 必须使用 `https` 来源，并与其他所有账户字段一样进行长度限制，之后载荷才会被接受。
- 窗口无边框，其界面装饰由应用自行绘制。Webview 仅被授予精确的五个窗口权限（`start-dragging`、`minimize`、`toggle-maximize`、`is-maximized`、`close`），且作用域限定在 `main` 窗口；不暴露任何文件系统、shell、路径或事件权限，保险库访问始终经由应用自身的命令进行。

### 身份验证器快速解锁

Google Authenticator 快速解锁采用标准的 6 位数字、30 秒周期的 TOTP。TOTP 密钥和保险库数据密钥由 Windows DPAPI 保护，面向当前 Windows 用户，并绑定到保险库 ID。已成功的时间步无法重放，连续失败会触发指数退避冷却。

快速解锁是一项与设备绑定的便利功能，而不是可移植的第二加密密码。主密码始终可用，并且是唯一能在其他设备上解密备份的凭据。快速解锁的绑定信息绝不包含在备份中。

## 加密备份

- 手动备份使用 `.ghauth-backup` 格式，并通过 Rust 后端写入。
- 自动备份仅在 Github Auth 处于打开状态时运行，包括保险库处于锁定状态时。支持的间隔为 6 小时、12 小时、每天和每周。
- 默认的自动备份目录是 `%LOCALAPPDATA%\com.githubauth.vault\backups`；目录和保留数量可以在保险库设置中更改。
- 备份使用创建该备份时生效的主密码。更改当前主密码不会影响较早的备份。
- 导入首先需要该备份的原始密码。添加数据或将其放入带日期的备份分组会保留当前的保险库设置。
- 替换当前数据始终需要当前保险库密码作为单独的授权步骤。用户可以在替换前创建一个受当前密码保护的备份。
- 导入的数据会使用当前保险库的数据密钥和当前主密码封装器重新加密。导入绝不会更改当前密码或身份验证器绑定。

加密信封存储在 `%LOCALAPPDATA%\com.githubauth.vault` 下。生产构建已移除早期的 Manus 运行时、调试收集器和存储代理。

运行安全测试：

```powershell
pnpm test:security
cargo test --manifest-path src-tauri/Cargo.toml
```

在配置 Windows 代码签名证书之前，发布构建均为未签名状态。未签名的安装程序可能触发 Microsoft Defender SmartScreen 警告。
