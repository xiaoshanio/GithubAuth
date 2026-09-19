# Github Auth 本机接口

Github Auth 在桌面应用运行时监听 `127.0.0.1:46329`。服务不会绑定局域网地址，也不会返回 CORS 许可，设计用途是当前电脑上的原生程序和脚本。

## 调用方身份

所有提交和读取请求都必须携带完整的软件身份：

```json
{
  "application": {
    "name": "Example Tool",
    "developer": "Example Studio",
    "icon": "data:image/png;base64,...",
    "description": "说明为什么需要本次请求"
  }
}
```

`icon` 可以是 HTTPS 图片，或不超过 256 KiB 的 PNG、JPEG、WebP、GIF、ICO Base64 data URL。

## 提交账户

`POST http://127.0.0.1:46329/v1/import-requests`

```json
{
  "application": {
    "name": "Example Tool",
    "developer": "Example Studio",
    "icon": "https://example.com/icon.png",
    "description": "从本地迁移 GitHub 账户"
  },
  "accounts": [
    {
      "name": "octocat",
      "email": "octo@example.com",
      "password": "account-password",
      "emails": ["backup@example.com"],
      "totpSecret": "OPTIONAL_BASE32_SECRET",
      "note": "可选备注"
    }
  ]
}
```

账户名称、邮箱和密码必填；一次最多提交 100 个账户。接口返回 `202 Accepted` 和 `statusUrl`。Github Auth 会弹出居中确认窗口，用户可预览数据、选择现有分组、保持未分组或快捷创建新分组，并通过主密码或 2FA 验证后导入。

调用方可以轮询返回的 `statusUrl` 查看 `pending`、`approved`、`denied` 或 `expired` 状态。未处理请求会在 10 分钟后过期，待导入的密码和 2FA 数据随即从运行时内存移除。

## 请求读取账户

读取接口默认暂停。用户必须在“本机接口与 API Key”页面启动读取，并创建只绑定一个分组的 API Key。API Key 仅显示一次，Github Auth 只保存其 SHA-256 哈希。

`POST http://127.0.0.1:46329/v1/accounts/query`

```http
Authorization: Bearer gha_...
Content-Type: application/json
```

```json
{
  "application": {
    "name": "Example Tool",
    "developer": "Example Studio",
    "icon": "https://example.com/icon.png",
    "description": "为本地自动化读取团队账户"
  }
}
```

有效请求返回 `202 Accepted`。Github Auth 会显示调用程序、开发者、说明、API Key 名称、授权分组和账户预览。用户通过主密码或 2FA 验证后仅放行本次请求。

调用方随后使用同一个 API Key 轮询响应里的 `statusUrl`：

```http
GET http://127.0.0.1:46329/v1/requests/<request-id>
Authorization: Bearer gha_...
```

批准后，状态响应包含该 API Key 所绑定分组及其中账户。若读取服务已暂停、API Key 被禁用或删除，已经批准但尚未取走的数据也不会返回。

## 审计

接口页面显示加密审计日志，包括调用程序、开发者、时间、接口、结果、API Key 名称、分组、账户数量和本机来源地址。日志不记录明文密码、2FA 密钥或完整 API Key。
