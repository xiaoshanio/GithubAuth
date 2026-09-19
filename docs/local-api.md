# Github Auth 加密本机接口 v2

Github Auth v2 在 `https://127.0.0.1:46329/v2` 提供仅回环可用的加密接口。服务不绑定 `0.0.0.0`，不返回 CORS 许可，不提供明文敏感接口，也不允许客户端跳过证书校验。

本机制的目标是防止未授权本机进程监听、篡改或重放传输内容，并通过证书固定阻止端口劫持后的伪造服务端。它不能防御管理员或 SYSTEM、内核级恶意软件、进程注入、Github Auth 或调用程序的内存读取，也不能阻止调用程序在解密后主动泄露数据。

## 1. 安全架构

- 传输层：rustls TLS 1.3，仅监听 `127.0.0.1:46329`。
- 服务端身份：首次启动生成本地 CA、TLS 服务端证书、静态 X25519 密钥和随机 `instanceId`。
- 私钥存储：服务身份以当前 Windows 用户的 DPAPI 加密，原子写入 Tauri app-local-data；备份系统不包含该文件。
- 服务端固定：客户端必须先执行正常的证书链与主机名校验，再校验导出配置中的 SPKI SHA-256 指纹。禁止 `danger_accept_invalid_certs`、`rejectUnauthorized: false` 或同类选项。
- 客户端身份：账户导入和读取只接受已配对客户端；读取同时要求由本机 CA 签发的客户端证书、`clientId`、API Key 与分组权限全部匹配。
- 应用层加密：每个请求使用新的临时 X25519 密钥，通过 HKDF-SHA256 派生消息密钥，并用 ChaCha20-Poly1305 加密。TLS 被本机高权限组件终止时，敏感正文仍不是明文。
- 防重放：UUID `requestId`、随机 nonce、UTC 时间戳、客户端和路由均被认证；30 秒窗口内按客户端缓存 requestId/nonce，并把短期缓存原子持久化。
- 审批：导入和读取均返回 `202`；读取响应必须由用户逐次批准，且只允许成功领取一次。
- 锁定行为：保管库锁定时服务不解密导入正文，返回 `423 Locked`。客户端应在解锁后使用同一加密信封重试；该请求尚未进入防重放缓存。

新增依赖分别用于异步 TLS HTTP 服务、TLS 1.3/mTLS、X.509 CSR 签发和 X25519/HKDF/ChaCha20-Poly1305 标准密码学，没有自定义加密算法。

## 2. 连接配置

页面导出的 JSON 只包含：

```json
{
  "version": 2,
  "address": "https://127.0.0.1:46329/v2",
  "instanceId": "UUID",
  "serverSpkiSha256": "sha256/BASE64",
  "serverX25519PublicKey": "BASE64_32_BYTES",
  "caCertificatePem": "-----BEGIN CERTIFICATE-----..."
}
```

文件不含账户、API Key、任何服务端或客户端私钥、主密码或 2FA 密钥。客户端必须显式导入并固定此配置，不能从网络自动信任新指纹。

## 3. 加密信封

所有 v2 POST 请求使用：

```json
{
  "version": 2,
  "instanceId": "UUID",
  "clientId": "UUID",
  "requestId": "EACH_HTTP_REQUEST_USES_A_NEW_UUID",
  "timestamp": "2026-09-19T12:34:56Z",
  "route": "/v2/account-requests",
  "ephemeralPublicKey": "BASE64_32_BYTES",
  "nonce": "BASE64_12_BYTES",
  "ciphertext": "BASE64_CIPHERTEXT_AND_TAG",
  "keyId": "OPTIONAL_NON_SECRET_ID"
}
```

派生规则：

1. 每次 HTTP 请求生成新的临时 X25519 密钥对。
2. `shared = X25519(ephemeralPrivateKey, serverX25519PublicKey)`。
3. `salt = SHA256(UTF8(instanceId) || 0x00 || UTF8(clientId))`。
4. `info = UTF8("github-auth-local-api:v2") || 0x00 || UTF8(route) || 0x00 || UTF8(requestId)`。
5. `key = HKDF-SHA256(shared, salt, info, 32)`。
6. 使用 12 字节安全随机 nonce 和 ChaCha20-Poly1305。

AAD 是以下 JSON 数组的 UTF-8 编码，顺序不可改变：

```json
[
  2,
  "instanceId",
  "clientId",
  "requestId",
  "timestamp",
  "route",
  "ephemeralPublicKey"
]
```

响应使用新的服务端临时 X25519 密钥，并加密到配对时保存的客户端静态 X25519 公钥。

## 4. 配对流程

客户端必须自行生成并保管 TLS 私钥/CSR、静态 X25519 私钥/公钥和随机 UUID `clientId`。Github Auth 不生成或返回客户端私钥。

```text
客户端                Github Auth TLS v2              用户界面
  | 导入固定 CA/SPKI          |                          |
  | 生成 TLS 私钥/CSR         |                          |
  | 生成静态 X25519 密钥      |                          |
  |--加密 pairing-requests--->|--显示来源与权限---------->|
  |                           |<--主密码/2FA 批准或拒绝---|
  |--加密 pairing-status----->|                          |
  |<--加密证书/CA或拒绝状态----|                          |
```

### `POST /v2/pairing-requests`

首次配对不要求客户端证书，但仍要求正常 TLS CA/主机名校验、SPKI 固定和应用层加密。解密正文：

```json
{
  "application": {
    "name": "Example Tool",
    "developer": "Example Studio",
    "icon": "data:image/png;base64,...",
    "description": "详细说明用途",
    "executablePath": "C:\\Tools\\example.exe"
  },
  "purpose": "详细说明本次配对用途",
  "clientCsr": "-----BEGIN CERTIFICATE REQUEST-----...",
  "encryptionPublicKey": "BASE64_32_BYTES",
  "allowImport": true,
  "allowRead": true,
  "groupId": "READ_GROUP_ID",
  "keyId": "API_KEY_ID",
  "keySecret": "gha_..."
}
```

读取权限需要 `groupId`、`keyId`、`keySecret`。secret 只出现在加密正文。批准后 API Key 才绑定 `clientId`，服务端验证 CSR 签名并签发 90 天客户端证书。

服务在 Windows 上通过 IP Helper 表把当前已建立的回环 TCP 四元组映射到 PID，再从进程句柄读取真实可执行文件路径，前后两次计算文件 SHA-256，并用 WinTrust 离线校验 Authenticode 与提取发布者。只有整条链路成功才显示“已验证”；任何查询失败、无签名、签名无效或文件在检查期间改变，均显示“调用方自报信息，未验证可执行程序”。安全授权仍以证书、clientId、X25519 公钥和 Key 绑定为主。

成功提交返回 `202` 加密状态；使用新信封轮询 `POST /v2/pairing-status`，解密正文为：

```json
{ "requestId": "ORIGINAL_PAIRING_REQUEST_ID" }
```

批准结果一次性返回客户端证书、CA 公共证书、到期时间和 clientId。

## 5. 导入流程

```text
已配对客户端          Github Auth                   用户界面/保管库
  |--mTLS + 加密正文---->|                            |
  |<--202 加密状态-------|--解密并显示预览------------>|
  |                     |<--选择分组 + 主密码/2FA------|
  |                     |--加密保存到账户保管库-------->|
  |--加密状态轮询-------->|                            |
  |<--approved/denied----|                            |
```

### `POST /v2/import-requests`

要求有效配对证书、clientId 匹配、客户端启用且拥有 `allowImport`。正文：

```json
{
  "application": {
    "name": "Example Tool",
    "developer": "Example Studio",
    "icon": "https://example.com/icon.png",
    "description": "迁移账户",
    "executablePath": "C:\\Tools\\example.exe"
  },
  "purpose": "从旧工具迁移用户主动选择的账户",
  "accounts": [
    {
      "name": "octocat",
      "email": "octo@example.com",
      "password": "secret",
      "emails": ["backup@example.com"],
      "totpSecret": "OPTIONAL_BASE32",
      "note": "optional",
      "avatarUrl": null,
      "githubCreatedAt": null
    }
  ]
}
```

名称、邮箱和密码必填；最多 100 个账户；请求体上限 1 MiB。锁定时返回 `423`，不解密也不保留密码。已接受的待处理导入在运行时只保存原始加密信封，只有已解锁 UI 获取预览时短暂解密。

## 6. 读取流程

```text
已配对客户端          Github Auth                   用户界面
  |--mTLS + 加密请求---->|                            |
  |                     |--显示程序/Key/分组/账户预览->|
  |<--202 pending--------|<--主密码/2FA 单次批准--------|
  |--加密状态轮询-------->|                            |
  |<--加密账户响应一次----|                            |
  |--再次轮询------------>|                            |
  |<--410 delivered------|                            |
```

### `POST /v2/account-requests`

要求读取服务已启动、mTLS 有效、客户端拥有 `allowRead`、软件身份字段与配对记录一致、Key 有效且绑定同一 clientId 和分组。正文：

```json
{
  "application": {
    "name": "Example Tool",
    "developer": "Example Studio",
    "icon": "https://example.com/icon.png",
    "description": "执行本地自动化",
    "executablePath": "C:\\Tools\\example.exe"
  },
  "purpose": "本次读取的具体用途",
  "keyId": "NON_SECRET_ID",
  "keySecret": "gha_..."
}
```

外层 keyId 必须与正文一致；keySecret 不得进入 URL、查询参数、Header 或日志。有效请求只创建审批记录。

### `POST /v2/request-status`

每次轮询使用新的外层 requestId/nonce/临时密钥。正文：

```json
{
  "requestId": "ORIGINAL_ACCOUNT_OR_IMPORT_REQUEST_ID",
  "keyId": "REQUIRED_FOR_ACCOUNT_READ",
  "keySecret": "gha_REQUIRED_FOR_ACCOUNT_READ"
}
```

读取响应路由为 `/v2/account-responses`，只包含授权分组账户，未分组账户永不返回。成功领取后状态变为 `delivered`，再次领取返回 `410`。读取服务暂停、Key/客户端禁用或删除、Key 过期、分组删除时，已批准响应也不能领取。

## 7. 状态、迁移与备份

- `202` 待批准；`400` 信封/AEAD/AAD/重放失败；`401` 证书或 Key 无效；`403` 权限/分组错误；`410` 已领取或过期；`423` 锁定；`426` v1 已停用；`429` 限流。
- 明文 HTTP 不存在回退；向端口发送明文会在 TLS 握手阶段被拒绝。TLS 下 `/v1/*` 返回 `426 Upgrade Required`。
- Key 使用系统 CSPRNG 生成 256 bit secret，只显示一次，只保存 SHA-256 哈希并常量时间比较。
- Key 必须绑定具体分组，不能绑定全部或未分组账户，支持暂停、删除、过期和最后使用时间。
- 旧 Key 缺少客户端绑定，升级后标记 `requiresRepair`，重新配对前处于安全禁用状态。
- 备份不含 CA/TLS/X25519 私钥或 DPAPI 文件。替换导入保留当前安装的本机接口状态，不激活来源设备权限。
- 身份轮换会撤销客户端、暂停读取并禁用 Key；旧客户端必须重新配对。

## 8. 审计

最多 500 条并存放于加密保管库。记录时间、clientId、程序、开发者、证书/文件哈希缩写、Key 名称、路由、动作、结果、分组、数量、来源 PID/地址、requestId 和失败原因。不记录主密码、2FA、密码、完整 Key、私钥、完整请求明文或消息密钥。

## 9. 客户端示例

[`docs/examples/local-api-client.ts`](examples/local-api-client.ts) 演示 Node.js 的系统 CA + SPKI 双重验证、mTLS、临时 X25519、HKDF、ChaCha20-Poly1305、AAD 和状态轮询；它不会关闭证书验证。

客户端可自行生成 TLS 私钥和 CSR：

```powershell
openssl genpkey -algorithm Ed25519 -out client-tls-key.pem
openssl req -new -key client-tls-key.pem -out client.csr.pem -subj "/CN=Example Tool"
```

## 10. 手动安全验收

1. 导出配置，确认只含版本、地址、instanceId、SPKI、X25519 公钥和 CA 公证书。
2. 用 Wireshark/Npcap 捕获回环流量，提交唯一测试标记的名称、邮箱、密码、2FA、Key、备注；确认 pcap 找不到标记。
3. 用另一证书代理/抢占 46329，保持旧 SPKI 配置；确认客户端发送信封前停止。
4. 重发完全相同信封、分别复用 requestId/nonce，确认拒绝。
5. 修改 ciphertext、nonce、timestamp、route 或 ephemeralPublicKey，确认认证失败。
6. 用 A 组 Key 请求 B 组或未分组账户，确认拒绝。
7. 不批准时永远得不到密码；批准后首次领取成功，第二次 `410`。
8. 批准后先暂停服务/Key/客户端再领取，确认拒绝。
9. 锁定后发送导入，确认 `423` 且没有导入预览或明文。
10. 搜索日志，确认无密码、2FA、完整 Key、私钥或正文。
11. 回归创建、编辑、分组、备份、恢复和解锁账户。

## 11. 尚未解决的风险

- Windows PID 映射和文件验证是尽力校验，无法达到内核强制的进程证明；查询失败时会降级为明确的“未验证”状态，而不会假装成功。
- 管理员/SYSTEM、内核恶意软件、进程注入和内存读取超出边界。
- 合法客户端解密后的数据可能被该客户端泄露。
- 抓包、端口抢占、真实 Windows 进程注入属于发布前人工验收项目。
