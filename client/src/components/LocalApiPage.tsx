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
import type {
  LocalApiLog,
  LocalApiRuntimeStatus,
  VaultPayload,
} from "@/lib/types";
import { vaultApi } from "@/lib/vaultApi";
import {
  Activity,
  ArrowLeft,
  Check,
  Clipboard,
  Download,
  Fingerprint,
  Folder,
  KeyRound,
  Link2,
  LockKeyhole,
  Network,
  PauseCircle,
  Radio,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
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
  if (outcome === "expired" || outcome === "failed")
    return "bg-orange-400/10 text-orange-300";
  return "bg-zinc-400/10 text-zinc-400";
}

function actionLabel(log: LocalApiLog, zh: boolean) {
  const labels: Record<string, [string, string]> = {
    client_paired: ["客户端已配对", "Client paired"],
    import_request: ["收到加密导入请求", "Encrypted import received"],
    import_approved: ["账户已导入", "Accounts imported"],
    import_denied: ["导入被拒绝", "Import denied"],
    account_request: ["收到加密读取请求", "Encrypted read received"],
    account_approved: ["一次性读取已批准", "One-time read approved"],
    account_denied: ["读取被拒绝", "Read denied"],
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
  const [runtime, setRuntime] = useState<LocalApiRuntimeStatus | null>(null);
  const [keyName, setKeyName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [expiryDays, setExpiryDays] = useState("90");
  const [keyCredential, setKeyCredential] = useState("");
  const [generatedKey, setGeneratedKey] = useState<{
    id: string;
    secret: string;
  } | null>(null);
  const [enableOpen, setEnableOpen] = useState(false);
  const [enableCredential, setEnableCredential] = useState("");
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotateCredential, setRotateCredential] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const [programFilter, setProgramFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");

  async function refreshRuntime() {
    try {
      setRuntime(await vaultApi.getLocalApiRuntimeStatus());
    } catch {
      setRuntime(null);
    }
  }

  useEffect(() => {
    void refreshRuntime();
  }, []);

  useEffect(() => {
    if (groupId && vault.groups.some(group => group.id === groupId)) return;
    setGroupId(vault.groups[0]?.id ?? "");
  }, [groupId, vault.groups]);

  const groupNames = useMemo(
    () => new Map(vault.groups.map(group => [group.id, group.name])),
    [vault.groups]
  );
  const clientNames = useMemo(
    () =>
      new Map(
        vault.localApi.clients.map(client => [
          client.id,
          client.applicationName,
        ])
      ),
    [vault.localApi.clients]
  );
  const programs = useMemo(
    () =>
      Array.from(new Set(vault.localApi.logs.map(log => log.appName))).sort(),
    [vault.localApi.logs]
  );
  const visibleLogs = useMemo(
    () =>
      vault.localApi.logs.filter(
        log =>
          (programFilter === "all" || log.appName === programFilter) &&
          (resultFilter === "all" || log.outcome === resultFilter) &&
          (actionFilter === "all" || log.action === actionFilter)
      ),
    [vault.localApi.logs, programFilter, resultFilter, actionFilter]
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

  async function exportConnection() {
    setWorking("export-config");
    try {
      const path = await vaultApi.exportLocalApiConnection();
      if (path) toast.success(zh ? `已导出到 ${path}` : `Exported to ${path}`);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setWorking(null);
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
        Number(expiryDays),
        quickUnlockEnabled ? "totp" : "password",
        keyCredential.trim()
      );
      applyConfig(result.config);
      setGeneratedKey({ id: result.keyId, secret: result.apiKey });
      setKeyName("");
      setKeyCredential("");
      toast.success(
        zh
          ? "API Key 已创建；配对客户端后才能读取。"
          : "API key created; pair a client before reads are allowed."
      );
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
    setWorking("read-service");
    try {
      applyConfig(await vaultApi.setLocalApiExportEnabled(false));
      toast.info(zh ? "账户读取服务已暂停。" : "Account reads paused.");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setWorking(null);
    }
  }

  async function enableExport() {
    if (!enableCredential.trim()) return;
    setWorking("enable-read");
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
      toast.success(zh ? "账户读取服务已启动。" : "Account reads enabled.");
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
    if (!window.confirm(zh ? "删除此 API Key？" : "Delete this API key?"))
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

  async function toggleClient(clientId: string, enabled: boolean) {
    setWorking(clientId);
    try {
      applyConfig(await vaultApi.setLocalApiClientEnabled(clientId, enabled));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setWorking(null);
    }
  }

  async function revokeClient(clientId: string, rePair = false) {
    if (
      !window.confirm(
        rePair
          ? zh
            ? "当前证书会立即失效；请随后从调用程序重新发起配对。继续吗？"
            : "The current certificate will be revoked. Start pairing again from the client afterward. Continue?"
          : zh
            ? "撤销后，该客户端证书与绑定的 API Key 会立即失效。继续吗？"
            : "The certificate and bound API key will stop working immediately. Continue?"
      )
    )
      return;
    setWorking(clientId);
    try {
      applyConfig(await vaultApi.revokeLocalApiClient(clientId));
      toast.info(
        rePair
          ? zh
            ? "旧身份已撤销，等待客户端重新配对。"
            : "Old identity revoked; waiting for the client to pair again."
          : zh
            ? "客户端已撤销。"
            : "Client revoked."
      );
    } catch (error) {
      toast.error(String(error));
    } finally {
      setWorking(null);
    }
  }

  async function rotateIdentity() {
    if (!rotateCredential.trim()) return;
    setWorking("rotate");
    try {
      onVaultChange(
        await vaultApi.rotateLocalApiIdentity(
          quickUnlockEnabled ? "totp" : "password",
          rotateCredential.trim()
        )
      );
      setRotateOpen(false);
      setRotateCredential("");
      await refreshRuntime();
      toast.success(
        zh
          ? "本机接口身份已轮换，旧客户端需要重新配对。"
          : "Local identity rotated; old clients must pair again."
      );
    } catch (error) {
      toast.error(String(error));
    } finally {
      setWorking(null);
    }
  }

  return (
    <>
      <section className="flex h-full min-h-0 flex-1 flex-col bg-[#08080a] text-white">
        <header className="flex shrink-0 items-start gap-3 border-b border-white/[0.08] px-4 pb-5 pt-6 sm:px-6">
          <button
            type="button"
            onClick={onBack}
            aria-label={zh ? "返回" : "Back"}
            className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[9px] text-zinc-400 hover:bg-white/[0.06] hover:text-white"
          >
            <ArrowLeft size={17} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="flex items-center gap-2 text-lg font-extrabold tracking-[-0.03em]">
                <Network size={18} className="text-violet-300" />
                {zh ? "本机接口与 API Key" : "Local API & API Keys"}
              </h1>
              <span className="rounded-full bg-violet-400/10 px-2.5 py-1 text-[10px] font-bold text-violet-200">
                v{runtime?.protocolVersion ?? 2} · TLS 1.3
              </span>
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
                    ? "仅 127.0.0.1"
                    : "127.0.0.1 only"
                  : zh
                    ? "服务不可用"
                    : "Unavailable"}
              </span>
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              {zh
                ? "防止未授权本机进程监听传输内容；所有敏感正文均经过 TLS 与应用层双重加密。"
                : "Protects transport content from unauthorized local processes with TLS plus application-layer encryption."}
            </p>
          </div>
        </header>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          <div className="mx-auto max-w-6xl space-y-6">
            <section className="grid gap-4 lg:grid-cols-3">
              {[
                [
                  "TLS 1.3",
                  runtime?.tls13,
                  zh ? "仅启用 TLS 1.3" : "TLS 1.3 only",
                ],
                [
                  "mTLS",
                  runtime?.mtls,
                  zh
                    ? "读取必须提供客户端证书"
                    : "Client certificate required for reads",
                ],
                [
                  zh ? "应用层加密" : "Envelope encryption",
                  true,
                  "X25519 · HKDF-SHA256 · ChaCha20-Poly1305",
                ],
              ].map(([label, active, detail]) => (
                <div
                  key={String(label)}
                  className="rounded-2xl border border-emerald-300/15 bg-emerald-400/[0.035] p-5"
                >
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <ShieldCheck size={16} className="text-emerald-300" />
                    {label}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-zinc-500">
                    {detail}
                  </p>
                  <p className="mt-3 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-300">
                    {active
                      ? zh
                        ? "已启用"
                        : "Active"
                      : zh
                        ? "不可用"
                        : "Unavailable"}
                  </p>
                </div>
              ))}
            </section>

            <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <Fingerprint size={16} className="text-violet-300" />
                    {zh ? "服务身份与证书固定" : "Service identity & pinning"}
                  </p>
                  <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-[150px_1fr]">
                    <dt className="text-zinc-600">Instance ID</dt>
                    <dd className="mono break-all text-zinc-300">
                      {runtime?.instanceId ?? "—"}
                    </dd>
                    <dt className="text-zinc-600">SPKI SHA-256</dt>
                    <dd className="mono break-all text-zinc-300">
                      {runtime?.spkiFingerprint ?? "—"}
                    </dd>
                    <dt className="text-zinc-600">X25519</dt>
                    <dd className="mono break-all text-zinc-300">
                      {runtime?.serverEncryptionPublicKey ?? "—"}
                    </dd>
                  </dl>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={!runtime}
                    onClick={() => runtime && copy(runtime.spkiFingerprint)}
                  >
                    <Clipboard size={14} /> {zh ? "复制指纹" : "Copy pin"}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!runtime || working === "export-config"}
                    onClick={exportConnection}
                  >
                    {working === "export-config" ? (
                      <Spinner className="size-4" />
                    ) : (
                      <Download size={14} />
                    )}
                    {zh ? "导出连接配置" : "Export config"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setRotateOpen(true)}
                    className="border-red-300/15 text-red-200"
                  >
                    <RefreshCw size={14} />{" "}
                    {zh ? "轮换身份" : "Rotate identity"}
                  </Button>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5 text-xs text-zinc-500">
                <Link2 size={14} className="shrink-0 text-violet-300" />
                <span className="mono min-w-0 flex-1 truncate">
                  {runtime?.baseUrl ?? "https://127.0.0.1:46329/v2"}
                </span>
              </div>
            </section>

            <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="flex items-center gap-2 text-sm font-bold">
                    {vault.localApi.exportEnabled ? (
                      <ShieldCheck size={16} className="text-emerald-300" />
                    ) : (
                      <PauseCircle size={16} className="text-amber-300" />
                    )}
                    {zh ? "账户读取服务" : "Account read service"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-600">
                    {zh
                      ? "默认暂停；即使启动，每次读取仍需居中弹窗确认并再次验证。"
                      : "Paused by default. Every read still needs a centered confirmation and fresh verification."}
                  </p>
                </div>
                <Switch
                  checked={vault.localApi.exportEnabled}
                  disabled={working === "read-service"}
                  onCheckedChange={toggleExport}
                  aria-label={zh ? "账户读取服务开关" : "Account read service"}
                />
              </div>
            </section>

            <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <LockKeyhole size={16} className="text-violet-300" />
                    {zh ? "已配对程序" : "Paired applications"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-600">
                    {zh
                      ? "证书、客户端 ID、X25519 公钥和分组权限必须同时匹配。"
                      : "Certificate, client ID, X25519 key and group scope must all match."}
                  </p>
                </div>
                <span className="mono text-xs text-zinc-600">
                  {vault.localApi.clients.length}
                </span>
              </div>
              <div className="space-y-2">
                {vault.localApi.clients.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-white/[0.09] px-4 py-7 text-center text-xs text-zinc-600">
                    {zh ? "尚无已配对程序。" : "No paired applications."}
                  </p>
                ) : (
                  vault.localApi.clients.map(client => (
                    <article
                      key={client.id}
                      className="rounded-xl border border-white/[0.07] bg-black/15 p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="break-words text-sm">
                              {client.applicationName}
                            </strong>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${client.signatureStatus === "verified" ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-300/10 text-amber-200"}`}
                            >
                              {client.signatureStatus === "verified"
                                ? zh
                                  ? "已验证"
                                  : "Verified"
                                : zh
                                  ? "自报，未验证"
                                  : "Self-reported"}
                            </span>
                          </div>
                          <p className="mt-1 break-words text-xs text-zinc-500">
                            {client.developer} ·{" "}
                            {client.allowImport ? "IMPORT" : ""}{" "}
                            {client.allowRead ? "READ" : ""}
                          </p>
                          <p className="mono mt-2 break-all text-[10px] text-zinc-700">
                            {client.certificateFingerprint} ·{" "}
                            {zh ? "到期" : "expires"}{" "}
                            {new Date(client.expiresAt).toLocaleString(
                              language
                            )}
                          </p>
                          {client.executablePath && (
                            <p className="mt-1 break-all text-[10px] text-zinc-700">
                              {client.executablePath}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                          <Switch
                            checked={client.enabled}
                            disabled={working === client.id}
                            onCheckedChange={enabled =>
                              toggleClient(client.id, enabled)
                            }
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={working === client.id}
                            onClick={() => revokeClient(client.id, true)}
                          >
                            <RefreshCw size={14} />{" "}
                            {zh ? "重新配对" : "Re-pair"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={working === client.id}
                            onClick={() => revokeClient(client.id)}
                            className="text-red-300"
                          >
                            <ShieldOff size={14} /> {zh ? "撤销" : "Revoke"}
                          </Button>
                        </div>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
              <div>
                <p className="flex items-center gap-2 text-sm font-bold">
                  <KeyRound size={16} className="text-violet-300" /> API Keys
                </p>
                <p className="mt-1 text-xs text-zinc-600">
                  {zh
                    ? "密钥只显示一次，只绑定一个具体分组，并在客户端配对时绑定证书身份。"
                    : "Secrets are shown once, scoped to one group, and bound to a paired certificate identity."}
                </p>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_150px_1fr_auto]">
                <Input
                  value={keyName}
                  onChange={event => setKeyName(event.target.value)}
                  placeholder={zh ? "密钥名称" : "Key name"}
                />
                <Select value={groupId} onValueChange={setGroupId}>
                  <SelectTrigger>
                    <SelectValue placeholder={zh ? "选择分组" : "Group"} />
                  </SelectTrigger>
                  <SelectContent>
                    {vault.groups.map(group => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={expiryDays} onValueChange={setExpiryDays}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 {zh ? "天" : "days"}</SelectItem>
                    <SelectItem value="90">90 {zh ? "天" : "days"}</SelectItem>
                    <SelectItem value="365">
                      365 {zh ? "天" : "days"}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type={quickUnlockEnabled ? "text" : "password"}
                  inputMode={quickUnlockEnabled ? "numeric" : undefined}
                  value={keyCredential}
                  onChange={event => setKeyCredential(event.target.value)}
                  placeholder={
                    quickUnlockEnabled
                      ? "2FA"
                      : zh
                        ? "主密码"
                        : "Master password"
                  }
                />
                <Button
                  disabled={
                    working === "create-key" || vault.groups.length === 0
                  }
                  onClick={createKey}
                  className="bg-violet-500 hover:bg-violet-400"
                >
                  {working === "create-key" ? (
                    <Spinner className="size-4" />
                  ) : (
                    <KeyRound size={14} />
                  )}
                  {zh ? "创建" : "Create"}
                </Button>
              </div>
              {generatedKey && (
                <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-4">
                  <p className="text-xs font-bold text-amber-200">
                    {zh
                      ? "现在复制，关闭后无法再次查看"
                      : "Copy now; it cannot be shown again"}
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                    <Input
                      readOnly
                      value={generatedKey.id}
                      className="mono min-w-0 flex-1"
                    />
                    <Button
                      variant="outline"
                      onClick={() => copy(generatedKey.id)}
                    >
                      <Clipboard size={14} />
                      {zh ? "复制 Key ID" : "Copy key ID"}
                    </Button>
                    <Input
                      readOnly
                      value={generatedKey.secret}
                      className="mono min-w-0 flex-1"
                    />
                    <Button
                      variant="outline"
                      onClick={() => copy(generatedKey.secret)}
                    >
                      <Clipboard size={14} />
                      {zh ? "复制 secret" : "Copy secret"}
                    </Button>
                  </div>
                  <div className="mt-2 flex justify-end">
                    <Button
                      variant="ghost"
                      onClick={() => setGeneratedKey(null)}
                    >
                      {zh ? "完成" : "Done"}
                    </Button>
                  </div>
                </div>
              )}
              <div className="mt-5 space-y-2 border-t border-white/[0.08] pt-5">
                {vault.localApi.apiKeys.map(key => {
                  const groupName = groupNames.get(key.groupId);
                  const clientName = key.clientId
                    ? clientNames.get(key.clientId)
                    : null;
                  return (
                    <div
                      key={key.id}
                      className="flex flex-col gap-3 rounded-xl border border-white/[0.07] bg-black/15 p-4 sm:flex-row sm:items-center"
                    >
                      <span
                        className={`size-2 shrink-0 rounded-full ${key.enabled && !key.requiresRepair ? "bg-emerald-400" : "bg-zinc-700"}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-bold">
                          {key.name}
                        </p>
                        <p className="mt-1 break-words text-xs text-zinc-600">
                          <Folder size={11} className="mr-1 inline" />
                          {groupName ??
                            (zh ? "分组已删除" : "Deleted group")} ·{" "}
                          {clientName ??
                            (zh ? "需要重新配对" : "Pairing required")}
                        </p>
                        <p className="mt-1 text-[10px] text-zinc-700">
                          {key.requiresRepair
                            ? zh
                              ? "旧密钥已安全禁用，完成重新配对后才能读取"
                              : "Legacy key is safely disabled until re-paired"
                            : key.expiresAt
                              ? `${zh ? "到期" : "Expires"} ${new Date(key.expiresAt).toLocaleString(language)}`
                              : ""}
                        </p>
                      </div>
                      <Switch
                        checked={key.enabled && !key.requiresRepair}
                        disabled={
                          working === key.id || !groupName || key.requiresRepair
                        }
                        onCheckedChange={enabled => toggleKey(key.id, enabled)}
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
                  );
                })}
                {vault.localApi.apiKeys.length === 0 && (
                  <p className="py-6 text-center text-xs text-zinc-600">
                    {zh ? "还没有 API Key。" : "No API keys."}
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <Activity size={16} className="text-violet-300" />
                    {zh ? "加密审计日志" : "Encrypted audit log"}
                  </p>
                  <p className="mt-1 text-xs text-zinc-600">
                    {zh
                      ? "不记录密码、2FA 密钥、完整 API Key 或解密后的请求正文。"
                      : "Never records passwords, 2FA secrets, full API keys, or decrypted request bodies."}
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Select
                    value={programFilter}
                    onValueChange={setProgramFilter}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {zh ? "全部程序" : "All programs"}
                      </SelectItem>
                      {programs.map(program => (
                        <SelectItem key={program} value={program}>
                          {program}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={resultFilter} onValueChange={setResultFilter}>
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {zh ? "全部结果" : "All results"}
                      </SelectItem>
                      {[
                        "pending",
                        "success",
                        "denied",
                        "blocked",
                        "expired",
                        "failed",
                      ].map(result => (
                        <SelectItem key={result} value={result}>
                          {result}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={actionFilter} onValueChange={setActionFilter}>
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {zh ? "全部动作" : "All actions"}
                      </SelectItem>
                      {Array.from(
                        new Set(vault.localApi.logs.map(log => log.action))
                      ).map(action => (
                        <SelectItem key={action} value={action}>
                          {action}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="mt-4 max-h-[430px] space-y-2 overflow-y-auto pr-1">
                {visibleLogs.map(log => (
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
                    <p className="mt-2 break-words text-xs text-zinc-400">
                      {log.appName} · {log.developer}
                    </p>
                    <p className="mt-1 break-all text-xs leading-5 text-zinc-600">
                      {log.endpoint} · {log.accountCount}{" "}
                      {zh ? "个账户" : "account(s)"}
                      {log.groupId
                        ? ` · ${groupNames.get(log.groupId) ?? log.groupId}`
                        : ""}
                      {log.apiKeyName ? ` · ${log.apiKeyName}` : ""}
                    </p>
                    <p className="mt-1 break-all text-[11px] text-zinc-700">
                      {log.remoteAddress}
                      {log.sourcePid ? ` · PID ${log.sourcePid}` : ""}
                      {log.requestId ? ` · ${log.requestId}` : ""} ·{" "}
                      {log.detail}
                    </p>
                  </article>
                ))}
                {visibleLogs.length === 0 && (
                  <p className="py-8 text-center text-xs text-zinc-600">
                    {zh ? "没有匹配的日志。" : "No matching logs."}
                  </p>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.035] p-5 text-xs leading-6 text-zinc-500">
              <p className="flex items-center gap-2 text-sm font-bold text-amber-100">
                <ShieldCheck size={16} />
                {zh ? "安全边界" : "Security boundary"}
              </p>
              <p className="mt-2">
                {zh
                  ? "该机制用于防止未授权本机进程监听或重放传输内容，并通过固定证书阻止伪造服务端。它无法防御管理员或 SYSTEM、内核级恶意软件、进程注入、进程内存读取，或调用程序解密后的主动泄露。"
                  : "This prevents unauthorized local processes from observing or replaying transport and rejects forged servers through pinning. It cannot defeat Administrator/SYSTEM, kernel malware, process injection, process-memory reads, or disclosure by the client after decryption."}
              </p>
            </section>
          </div>
        </div>
      </section>

      <VerificationDialog
        open={enableOpen}
        onOpenChange={setEnableOpen}
        title={zh ? "启动账户读取服务" : "Enable account reads"}
        description={
          zh
            ? "启动后仍需 mTLS、应用层加密、分组 API Key 和逐次确认。"
            : "Reads still require mTLS, encrypted envelopes, a group key and per-request approval."
        }
        value={enableCredential}
        onValueChange={setEnableCredential}
        quickUnlockEnabled={quickUnlockEnabled}
        working={working === "enable-read"}
        onConfirm={enableExport}
        zh={zh}
      />
      <VerificationDialog
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        title={zh ? "轮换本机接口身份" : "Rotate local API identity"}
        description={
          zh
            ? "旧证书、已配对程序和 API Key 权限将立即失效，所有客户端都需要重新导入配置并配对。"
            : "Old certificates, paired clients and API key grants are revoked immediately. Every client must import the new configuration and pair again."
        }
        value={rotateCredential}
        onValueChange={setRotateCredential}
        quickUnlockEnabled={quickUnlockEnabled}
        working={working === "rotate"}
        onConfirm={rotateIdentity}
        zh={zh}
        destructive
      />
    </>
  );
}

function VerificationDialog({
  open,
  onOpenChange,
  title,
  description,
  value,
  onValueChange,
  quickUnlockEnabled,
  working,
  onConfirm,
  zh,
  destructive = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  value: string;
  onValueChange: (value: string) => void;
  quickUnlockEnabled: boolean;
  working: boolean;
  onConfirm: () => void;
  zh: boolean;
  destructive?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-white/[0.1] bg-[#141419] text-white">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
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
            value={value}
            onChange={event =>
              onValueChange(
                quickUnlockEnabled
                  ? event.target.value.replace(/\D/g, "")
                  : event.target.value
              )
            }
            onKeyDown={event => event.key === "Enter" && onConfirm()}
            className="mt-2"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {zh ? "取消" : "Cancel"}
          </Button>
          <Button
            disabled={working || !value.trim()}
            onClick={onConfirm}
            className={
              destructive
                ? "bg-red-600 hover:bg-red-500"
                : "bg-violet-500 hover:bg-violet-400"
            }
          >
            {working ? <Spinner className="size-4" /> : <Check size={15} />}
            {zh ? "验证并继续" : "Verify and continue"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
