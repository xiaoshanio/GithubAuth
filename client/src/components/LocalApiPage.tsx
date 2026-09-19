import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/contexts/LanguageContext";
import type { LocalApiLog, VaultPayload } from "@/lib/types";
import { vaultApi } from "@/lib/vaultApi";
import {
  Activity,
  ArrowLeft,
  Check,
  Clipboard,
  Code2,
  KeyRound,
  Network,
  PauseCircle,
  PlayCircle,
  Radio,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Props = {
  onBack: () => void;
  vault: VaultPayload;
  quickUnlockEnabled: boolean;
  onVaultChange: (payload: VaultPayload) => void;
};

function outcomeClass(outcome: string) {
  if (outcome === "success") return "bg-emerald-400/10 text-emerald-300";
  if (outcome === "pending") return "bg-amber-300/10 text-amber-200";
  if (outcome === "denied") return "bg-red-400/10 text-red-300";
  return "bg-zinc-400/10 text-zinc-400";
}

function actionLabel(log: LocalApiLog, zh: boolean) {
  const labels: Record<string, [string, string]> = {
    import_request: ["收到导入请求", "Import request received"],
    import_approved: ["账户已导入", "Accounts imported"],
    import_denied: ["导入被拒绝", "Import denied"],
    account_export: ["读取账户请求", "Account read request"],
    api_key_created: ["创建 API Key", "API key created"],
  };
  return labels[log.action]?.[zh ? 0 : 1] ?? log.action;
}

export default function LocalApiPage({
  onBack,
  vault,
  quickUnlockEnabled,
  onVaultChange,
}: Props) {
  const { language } = useLanguage();
  const zh = language.startsWith("zh");
  const [runtime, setRuntime] = useState<{
    listening: boolean;
    baseUrl: string;
    importEndpoint: string;
    exportEndpoint: string;
  } | null>(null);
  const [keyName, setKeyName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [keyCredential, setKeyCredential] = useState("");
  const [generatedKey, setGeneratedKey] = useState("");
  const [enableOpen, setEnableOpen] = useState(false);
  const [enableCredential, setEnableCredential] = useState("");
  const [working, setWorking] = useState<string | null>(null);

  useEffect(() => {
    vaultApi
      .getLocalApiRuntimeStatus()
      .then(setRuntime)
      .catch(() => setRuntime(null));
  }, []);

  useEffect(() => {
    if (groupId && vault.groups.some(group => group.id === groupId)) return;
    setGroupId(vault.groups[0]?.id ?? "");
  }, [groupId, vault.groups]);

  const groupNames = useMemo(
    () => new Map(vault.groups.map(group => [group.id, group.name])),
    [vault.groups]
  );

  function applyConfig(config: VaultPayload["localApi"]) {
    onVaultChange({ ...vault, localApi: config });
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(zh ? "已复制。" : "Copied.");
    } catch {
      toast.error(zh ? "无法访问剪贴板。" : "Clipboard unavailable.");
    }
  }

  async function createKey() {
    if (!keyName.trim() || !groupId || !keyCredential.trim()) {
      return toast.error(
        zh
          ? "请填写名称、授权分组和验证信息。"
          : "Enter a name, group and verification credential."
      );
    }
    setWorking("create-key");
    try {
      const result = await vaultApi.createLocalApiKey(
        keyName.trim(),
        groupId,
        quickUnlockEnabled ? "totp" : "password",
        keyCredential.trim()
      );
      applyConfig(result.config);
      setGeneratedKey(result.apiKey);
      setKeyName("");
      setKeyCredential("");
      toast.success(zh ? "API Key 已创建。" : "API key created.");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setWorking(null);
    }
  }

  async function toggleExport(checked: boolean) {
    if (checked) {
      setEnableCredential("");
      setEnableOpen(true);
      return;
    }
    setWorking("export");
    try {
      applyConfig(await vaultApi.setLocalApiExportEnabled(false));
      toast.info(zh ? "账户读取接口已暂停。" : "Account reads paused.");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setWorking(null);
    }
  }

  async function enableExport() {
    if (!enableCredential.trim()) {
      return toast.error(
        quickUnlockEnabled
          ? zh
            ? "请输入当前 2FA 验证码。"
            : "Enter the current 2FA code."
          : zh
            ? "请输入当前主密码。"
            : "Enter the current master password."
      );
    }
    setWorking("enable-export");
    try {
      applyConfig(
        await vaultApi.setLocalApiExportEnabled(
          true,
          quickUnlockEnabled ? "totp" : "password",
          enableCredential.trim()
        )
      );
      setEnableOpen(false);
      setEnableCredential("");
      toast.success(zh ? "账户读取接口已启动。" : "Account reads enabled.");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setWorking(null);
    }
  }

  async function toggleKey(keyId: string, enabled: boolean) {
    setWorking(keyId);
    try {
      applyConfig(await vaultApi.setLocalApiKeyEnabled(keyId, enabled));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setWorking(null);
    }
  }

  async function deleteKey(keyId: string) {
    if (
      !window.confirm(
        zh
          ? "删除后，使用该 API Key 的程序会立即失去访问权限。继续吗？"
          : "Programs using this API key will immediately lose access. Continue?"
      )
    )
      return;
    setWorking(keyId);
    try {
      applyConfig(await vaultApi.deleteLocalApiKey(keyId));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setWorking(null);
    }
  }

  return (
    <>
      <section className="flex h-full min-h-0 flex-1 flex-col bg-[#08080a] text-white">
        <header className="flex shrink-0 items-start gap-3 border-b border-white/[0.08] px-6 pb-5 pt-6">
          <button
            type="button"
            onClick={onBack}
            aria-label={zh ? "返回" : "Back"}
            className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[9px] text-zinc-400 transition hover:bg-white/[0.06] hover:text-white"
          >
            <ArrowLeft size={17} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="flex items-center gap-2 text-lg font-extrabold tracking-[-0.03em]">
                <Network size={18} className="text-violet-300" />
                {zh ? "本机接口与 API Key" : "Local API & API Keys"}
              </h1>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                  runtime?.listening
                    ? "bg-emerald-400/10 text-emerald-300"
                    : "bg-red-400/10 text-red-300"
                }`}
              >
                <Radio size={10} />
                {runtime?.listening
                  ? zh
                    ? "仅本机监听"
                    : "Loopback only"
                  : zh
                    ? "端口不可用"
                    : "Port unavailable"}
              </span>
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              {zh
                ? "接收添加请求、限制分组读取权限，并保留加密审计记录。"
                : "Receive import requests, scope account reads by group, and keep an encrypted audit trail."}
            </p>
          </div>
        </header>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-6xl space-y-6">
            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-emerald-300/15 bg-emerald-400/[0.035] p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-bold">
                      <PlayCircle size={16} className="text-emerald-300" />
                      {zh
                        ? "账户导入 · 始终收取"
                        : "Account imports · Receiving"}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-zinc-500">
                      {zh
                        ? "外部程序只能提交候选数据；每次都需要你在居中弹窗中预览、选择分组并验证后才会写入。"
                        : "Apps may only submit candidate data. Every request requires preview, group selection and verification."}
                    </p>
                  </div>
                  <span className="mt-1 size-2.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.65)]" />
                </div>
                <button
                  type="button"
                  onClick={() => runtime && copy(runtime.importEndpoint)}
                  className="mono mt-4 flex w-full items-center gap-2 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5 text-left text-[11px] text-zinc-400 hover:border-white/[0.14]"
                >
                  <Clipboard size={13} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {runtime?.importEndpoint ??
                      "http://127.0.0.1:46329/v1/import-requests"}
                  </span>
                </button>
              </div>

              <div
                className={`rounded-2xl border p-5 ${
                  vault.localApi.exportEnabled
                    ? "border-violet-300/20 bg-violet-400/[0.045]"
                    : "border-white/[0.08] bg-white/[0.025]"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-bold">
                      {vault.localApi.exportEnabled ? (
                        <Activity size={16} className="text-violet-300" />
                      ) : (
                        <PauseCircle size={16} className="text-zinc-500" />
                      )}
                      {zh
                        ? "账户读取 · 默认暂停"
                        : "Account reads · Paused by default"}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-zinc-500">
                      {zh
                        ? "启动后，程序仍须携带完整身份和分组专用 API Key；每次读取都会弹窗，由你验证后单次放行。"
                        : "Callers must identify the app and use a group-scoped key. Every read opens a one-time approval prompt."}
                    </p>
                  </div>
                  <Switch
                    checked={vault.localApi.exportEnabled}
                    disabled={working === "export"}
                    onCheckedChange={toggleExport}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => runtime && copy(runtime.exportEndpoint)}
                  className="mono mt-4 flex w-full items-center gap-2 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5 text-left text-[11px] text-zinc-400 hover:border-white/[0.14]"
                >
                  <Clipboard size={13} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {runtime?.exportEndpoint ??
                      "http://127.0.0.1:46329/v1/accounts/query"}
                  </span>
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <KeyRound size={16} className="text-violet-300" />
                    {zh
                      ? "新建分组专用 API Key"
                      : "Create a group-scoped API key"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-600">
                    {zh
                      ? "密钥只显示一次；保管库仅保存不可逆哈希。"
                      : "The key is shown once; only its one-way hash is stored."}
                  </p>
                </div>
                <ShieldCheck size={18} className="text-zinc-700" />
              </div>

              <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1.2fr_auto]">
                <div>
                  <Label>{zh ? "密钥名称" : "Key name"}</Label>
                  <Input
                    value={keyName}
                    onChange={event => setKeyName(event.target.value)}
                    placeholder={
                      zh ? "例如：团队自动化" : "e.g. Team automation"
                    }
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label>{zh ? "仅允许读取分组" : "Allowed group"}</Label>
                  <Select value={groupId} onValueChange={setGroupId}>
                    <SelectTrigger className="mt-2">
                      <SelectValue
                        placeholder={zh ? "选择分组" : "Choose group"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {vault.groups.map(group => (
                        <SelectItem key={group.id} value={group.id}>
                          {group.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>
                    {quickUnlockEnabled
                      ? zh
                        ? "当前 2FA 验证码"
                        : "Current 2FA code"
                      : zh
                        ? "当前主密码"
                        : "Current master password"}
                  </Label>
                  <Input
                    type={quickUnlockEnabled ? "text" : "password"}
                    inputMode={quickUnlockEnabled ? "numeric" : undefined}
                    maxLength={quickUnlockEnabled ? 6 : undefined}
                    value={keyCredential}
                    onChange={event =>
                      setKeyCredential(
                        quickUnlockEnabled
                          ? event.target.value.replace(/\D/g, "")
                          : event.target.value
                      )
                    }
                    onKeyDown={event => event.key === "Enter" && createKey()}
                    className="mt-2"
                  />
                </div>
                <Button
                  disabled={
                    working === "create-key" || vault.groups.length === 0
                  }
                  onClick={createKey}
                  className="self-end bg-violet-500 hover:bg-violet-400"
                >
                  {working === "create-key" ? (
                    <Spinner className="size-4" />
                  ) : (
                    <KeyRound size={15} />
                  )}
                  {zh ? "生成" : "Generate"}
                </Button>
              </div>
              {vault.groups.length === 0 && (
                <p className="mt-3 text-xs text-amber-200/70">
                  {zh
                    ? "请先创建至少一个分组；API Key 不允许访问“全部账户”或未分组账户。"
                    : "Create a group first. API keys cannot access all or ungrouped accounts."}
                </p>
              )}

              {generatedKey && (
                <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-4">
                  <p className="text-xs font-bold text-amber-200">
                    {zh
                      ? "现在复制此 API Key，关闭后无法再次查看"
                      : "Copy this API key now; it cannot be shown again"}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Input
                      readOnly
                      value={generatedKey}
                      className="mono min-w-0 flex-1 bg-black/25 text-xs"
                    />
                    <Button
                      variant="outline"
                      onClick={() => copy(generatedKey)}
                    >
                      <Clipboard size={15} /> {zh ? "复制" : "Copy"}
                    </Button>
                    <Button variant="ghost" onClick={() => setGeneratedKey("")}>
                      {zh ? "完成" : "Done"}
                    </Button>
                  </div>
                </div>
              )}

              <div className="mt-5 space-y-2 border-t border-white/[0.08] pt-5">
                {vault.localApi.apiKeys.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-white/[0.09] px-4 py-6 text-center text-xs text-zinc-600">
                    {zh ? "还没有 API Key。" : "No API keys yet."}
                  </p>
                ) : (
                  vault.localApi.apiKeys.map(key => {
                    const groupName = groupNames.get(key.groupId);
                    return (
                      <div
                        key={key.id}
                        className="flex flex-col gap-3 rounded-xl border border-white/[0.07] bg-black/15 px-4 py-3 sm:flex-row sm:items-center"
                      >
                        <span
                          className={`size-2 shrink-0 rounded-full ${key.enabled ? "bg-emerald-400" : "bg-zinc-700"}`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold">
                            {key.name}
                          </p>
                          <p className="mt-1 truncate text-xs text-zinc-600">
                            {zh ? "权限" : "Scope"}：
                            {groupName ?? (zh ? "分组已删除" : "Group deleted")}
                            {key.lastUsedAt
                              ? ` · ${zh ? "最近使用" : "Last used"} ${new Date(key.lastUsedAt).toLocaleString(language)}`
                              : ` · ${zh ? "尚未使用" : "Never used"}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={key.enabled}
                            disabled={working === key.id || !groupName}
                            onCheckedChange={enabled =>
                              toggleKey(key.id, enabled)
                            }
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={working === key.id}
                            onClick={() => deleteKey(key.id)}
                            className="text-zinc-600 hover:text-red-300"
                          >
                            <Trash2 size={15} />
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            <section className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-bold">
                      <Activity size={16} className="text-violet-300" />
                      {zh ? "API 审计日志" : "API audit log"}
                    </p>
                    <p className="mt-1 text-xs text-zinc-600">
                      {zh
                        ? "记录请求程序、开发者、结果、分组、数量和本机来源，不记录明文密码。"
                        : "Tracks caller, developer, result, group, count and local source without logging secrets."}
                    </p>
                  </div>
                  <span className="mono text-xs text-zinc-600">
                    {vault.localApi.logs.length}/500
                  </span>
                </div>
                <div className="max-h-[430px] space-y-2 overflow-y-auto pr-1">
                  {vault.localApi.logs.length === 0 ? (
                    <p className="py-10 text-center text-xs text-zinc-600">
                      {zh ? "暂无接口记录。" : "No API activity yet."}
                    </p>
                  ) : (
                    vault.localApi.logs.map(log => (
                      <article
                        key={log.id}
                        className="rounded-xl border border-white/[0.07] bg-black/15 p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="text-sm">
                            {actionLabel(log, zh)}
                          </strong>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${outcomeClass(log.outcome)}`}
                          >
                            {log.outcome}
                          </span>
                          <time className="ml-auto text-[10px] text-zinc-700">
                            {new Date(log.occurredAt).toLocaleString(language)}
                          </time>
                        </div>
                        <p className="mt-2 text-xs text-zinc-400">
                          {log.appName} · {log.developer}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-zinc-600">
                          {log.method} {log.endpoint} · {log.accountCount}{" "}
                          {zh ? "个账户" : "account(s)"}
                          {log.groupId
                            ? ` · ${groupNames.get(log.groupId) ?? log.groupId}`
                            : ""}
                          {log.apiKeyName ? ` · ${log.apiKeyName}` : ""}
                        </p>
                        <p className="mt-1 text-[11px] text-zinc-700">
                          {log.remoteAddress} · {log.detail}
                        </p>
                      </article>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
                <p className="flex items-center gap-2 text-sm font-bold">
                  <Code2 size={16} className="text-violet-300" />
                  {zh ? "调用约定" : "Request contract"}
                </p>
                <p className="mt-2 text-xs leading-5 text-zinc-600">
                  {zh
                    ? "两个 POST 接口都使用 application/json，并强制携带软件名称、开发者、图标和详细说明。读取接口将 API Key 放在 Authorization: Bearer 请求头；收到 202 后轮询返回的 statusUrl，读取轮询也必须携带同一密钥。"
                    : "Both POST endpoints require app identity. Reads use an Authorization: Bearer header; after 202, poll statusUrl with the same key."}
                </p>
                <pre className="no-scrollbar mt-4 overflow-x-auto rounded-xl border border-white/[0.07] bg-black/25 p-4 text-[10px] leading-5 text-zinc-400">
                  {`{
  "application": {
    "name": "Example Tool",
    "developer": "Example Studio",
    "icon": "data:image/png;base64,...",
    "description": "Why this request is needed"
  },
  "accounts": [{
    "name": "octocat",
    "email": "octo@example.com",
    "password": "...",
    "totpSecret": "OPTIONAL"
  }]
}`}
                </pre>
                <div className="mt-4 rounded-xl border border-sky-300/10 bg-sky-300/[0.04] p-3 text-[11px] leading-5 text-sky-100/60">
                  {zh
                    ? "服务不返回跨域许可，因此普通网页不能静默调用；它面向当前电脑上的原生程序或脚本。"
                    : "The service sends no CORS permission, so ordinary web pages cannot call it silently. It is intended for native apps and scripts on this computer."}
                </div>
              </div>
            </section>
          </div>
        </div>
      </section>

      <Dialog open={enableOpen} onOpenChange={setEnableOpen}>
        <DialogContent className="max-w-md border-white/[0.1] bg-[#141419] text-white">
          <DialogHeader>
            <DialogTitle>
              {zh ? "启动账户读取接口" : "Enable account reads"}
            </DialogTitle>
            <DialogDescription>
              {zh
                ? "启动后，有效 API Key 可发起其绑定分组的读取请求；每次仍需你在弹窗中确认。请输入安全验证信息启动。"
                : "Valid API keys may request reads for their assigned group; every request still requires your approval. Verify to enable."}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>
              {quickUnlockEnabled
                ? zh
                  ? "当前 2FA 验证码"
                  : "Current 2FA code"
                : zh
                  ? "当前主密码"
                  : "Current master password"}
            </Label>
            <Input
              autoFocus
              type={quickUnlockEnabled ? "text" : "password"}
              inputMode={quickUnlockEnabled ? "numeric" : undefined}
              maxLength={quickUnlockEnabled ? 6 : undefined}
              value={enableCredential}
              onChange={event =>
                setEnableCredential(
                  quickUnlockEnabled
                    ? event.target.value.replace(/\D/g, "")
                    : event.target.value
                )
              }
              onKeyDown={event => event.key === "Enter" && enableExport()}
              className="mt-2"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEnableOpen(false)}>
              {zh ? "取消" : "Cancel"}
            </Button>
            <Button
              disabled={working === "enable-export"}
              onClick={enableExport}
              className="bg-violet-500 hover:bg-violet-400"
            >
              {working === "enable-export" ? (
                <Spinner className="size-4" />
              ) : (
                <Check size={15} />
              )}
              {zh ? "验证并启动" : "Verify and enable"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
