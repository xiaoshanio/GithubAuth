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
import { useLanguage } from "@/contexts/LanguageContext";
import type { PendingApiImport, VaultGroup, VaultPayload } from "@/lib/types";
import { vaultApi } from "@/lib/vaultApi";
import {
  Check,
  Eye,
  EyeOff,
  FolderPlus,
  KeyRound,
  Mail,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Props = {
  request: PendingApiImport | null;
  groups: VaultGroup[];
  quickUnlockEnabled: boolean;
  onResolved: (payload: VaultPayload) => void;
};

function ApplicationIcon({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="grid size-14 shrink-0 place-items-center rounded-2xl border border-violet-300/20 bg-violet-400/10 text-xl font-black text-violet-200">
        {name.slice(0, 1).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className="size-14 shrink-0 rounded-2xl border border-white/10 bg-white object-cover"
      referrerPolicy="no-referrer"
    />
  );
}

export default function LocalApiImportDialog({
  request,
  groups,
  quickUnlockEnabled,
  onResolved,
}: Props) {
  const { language } = useLanguage();
  const zh = language.startsWith("zh");
  const [groupId, setGroupId] = useState("__none__");
  const [newGroupMode, setNewGroupMode] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [credential, setCredential] = useState("");
  const [visiblePasswords, setVisiblePasswords] = useState<Set<number>>(
    new Set()
  );
  const [working, setWorking] = useState<"approve" | "deny" | null>(null);

  useEffect(() => {
    setGroupId("__none__");
    setNewGroupMode(false);
    setNewGroupName("");
    setCredential("");
    setVisiblePasswords(new Set());
    setWorking(null);
  }, [request?.id]);

  if (!request) return null;

  async function approve() {
    if (!request) return;
    if (newGroupMode && !newGroupName.trim()) {
      return toast.error(zh ? "请输入新分组名称。" : "Enter a new group name.");
    }
    if (!credential.trim()) {
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
    setWorking("approve");
    try {
      const payload = await vaultApi.approveLocalApiImport(
        request.id,
        newGroupMode || groupId === "__none__" ? null : groupId,
        newGroupMode ? newGroupName.trim() : null,
        quickUnlockEnabled ? "totp" : "password",
        credential.trim()
      );
      onResolved(payload);
      toast.success(
        zh
          ? `已安全导入 ${request.accounts.length} 个账户。`
          : `Securely imported ${request.accounts.length} account(s).`
      );
    } catch (error) {
      toast.error(String(error));
    } finally {
      setWorking(null);
    }
  }

  async function deny() {
    if (!request) return;
    setWorking("deny");
    try {
      onResolved(await vaultApi.denyLocalApiImport(request.id));
      toast.info(zh ? "已拒绝该导入请求。" : "Import request denied.");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setWorking(null);
    }
  }

  function togglePassword(index: number) {
    setVisiblePasswords(current => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <Dialog open>
      <DialogContent
        className="max-h-[92vh] max-w-3xl overflow-hidden border-white/[0.11] bg-[#111116] p-0 text-white shadow-[0_30px_100px_rgba(0,0,0,0.65)] sm:rounded-3xl"
        onEscapeKeyDown={event => event.preventDefault()}
        onPointerDownOutside={event => event.preventDefault()}
      >
        <div className="border-b border-white/[0.08] bg-[radial-gradient(circle_at_top_right,rgba(168,85,247,0.16),transparent_42%)] px-6 py-5 sm:px-7">
          <DialogHeader>
            <div className="mb-4 flex items-start gap-4">
              <ApplicationIcon
                src={request.application.icon}
                name={request.application.name}
              />
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-200">
                    {zh ? "本机请求" : "Local request"}
                  </span>
                  <span className="text-xs text-zinc-600">
                    {new Date(request.requestedAt).toLocaleString(language)}
                  </span>
                </div>
                <DialogTitle className="text-xl font-black tracking-[-0.03em] sm:text-2xl">
                  {zh
                    ? `来自 ${request.application.name} 的账户导入请求`
                    : `Account import request from ${request.application.name}`}
                </DialogTitle>
                <DialogDescription className="mt-1.5 text-sm text-zinc-400">
                  {zh ? "开发者" : "Developer"}：{request.application.developer}
                </DialogDescription>
              </div>
            </div>
            <p className="rounded-xl border border-white/[0.07] bg-black/20 px-4 py-3 text-sm leading-6 text-zinc-400">
              {request.application.description}
            </p>
            <p className="break-words text-xs leading-5 text-violet-200/70">
              {zh ? "本次用途：" : "Purpose: "}
              {request.purpose}
            </p>
            <p className="break-all text-xs leading-5 text-amber-200/70">
              {request.signatureStatus === "verified"
                ? zh
                  ? "已验证调用程序"
                  : "Verified caller"
                : zh
                  ? "调用方自报信息，未验证可执行程序"
                  : "Caller-supplied identity; executable not verified"}
              {` · ${request.remoteAddress}`}
              {request.sourcePid ? ` · PID ${request.sourcePid}` : ""}
            </p>
          </DialogHeader>
        </div>

        <div className="no-scrollbar max-h-[55vh] overflow-y-auto px-6 py-5 sm:px-7">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold">
                {zh ? "即将添加的账户" : "Accounts to add"}
              </p>
              <p className="mt-1 text-xs text-zinc-600">
                {zh
                  ? `共 ${request.accounts.length} 个，确认前可检查每项数据。`
                  : `${request.accounts.length} total. Review every item before approving.`}
              </p>
            </div>
            <span className="mono rounded-lg bg-violet-400/10 px-2.5 py-1 text-xs text-violet-200">
              {request.accounts.length}
            </span>
          </div>

          <div className="space-y-2">
            {request.accounts.map((account, index) => (
              <article
                key={`${account.name}-${account.email}-${index}`}
                className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-zinc-400">
                    <UserRound size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="break-all text-sm">
                        {account.name}
                      </strong>
                      {account.totpSecret && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                          <ShieldCheck size={10} /> 2FA
                        </span>
                      )}
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 break-all text-xs text-zinc-500">
                      <Mail size={12} /> {account.email}
                    </p>
                    <div className="mt-3 flex items-center gap-2 rounded-lg bg-black/20 px-3 py-2">
                      <KeyRound size={13} className="shrink-0 text-zinc-600" />
                      <code className="min-w-0 flex-1 truncate text-xs text-zinc-400">
                        {visiblePasswords.has(index)
                          ? account.password
                          : "•".repeat(Math.min(16, account.password.length))}
                      </code>
                      <button
                        type="button"
                        onClick={() => togglePassword(index)}
                        className="text-zinc-600 transition hover:text-zinc-300"
                        aria-label={
                          zh ? "显示或隐藏密码" : "Show or hide password"
                        }
                      >
                        {visiblePasswords.has(index) ? (
                          <EyeOff size={14} />
                        ) : (
                          <Eye size={14} />
                        )}
                      </button>
                    </div>
                    {account.note && (
                      <p className="mt-2 text-xs leading-5 text-zinc-600">
                        {account.note}
                      </p>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>

          <section className="mt-5 border-t border-white/[0.08] pt-5">
            <div className="flex items-center justify-between gap-3">
              <Label>{zh ? "添加到分组" : "Add to group"}</Label>
              <button
                type="button"
                onClick={() => setNewGroupMode(value => !value)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-300 hover:text-violet-200"
              >
                <FolderPlus size={13} />
                {newGroupMode
                  ? zh
                    ? "选择现有分组"
                    : "Choose existing group"
                  : zh
                    ? "快捷创建分组"
                    : "Quick-create group"}
              </button>
            </div>
            {newGroupMode ? (
              <Input
                autoFocus
                value={newGroupName}
                onChange={event => setNewGroupName(event.target.value)}
                placeholder={zh ? "输入新分组名称" : "New group name"}
                className="mt-2"
              />
            ) : (
              <Select value={groupId} onValueChange={setGroupId}>
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    {zh ? "不选择分组（默认）" : "No group (default)"}
                  </SelectItem>
                  {groups.map(group => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <div className="mt-4">
              <Label htmlFor="local-api-import-credential">
                {quickUnlockEnabled
                  ? zh
                    ? "输入当前 2FA 验证码确认"
                    : "Enter the current 2FA code to confirm"
                  : zh
                    ? "输入当前主密码确认"
                    : "Enter the current master password to confirm"}
              </Label>
              <Input
                id="local-api-import-credential"
                type={quickUnlockEnabled ? "text" : "password"}
                inputMode={quickUnlockEnabled ? "numeric" : undefined}
                maxLength={quickUnlockEnabled ? 6 : undefined}
                value={credential}
                onChange={event =>
                  setCredential(
                    quickUnlockEnabled
                      ? event.target.value.replace(/\D/g, "")
                      : event.target.value
                  )
                }
                onKeyDown={event => event.key === "Enter" && approve()}
                className="mt-2"
              />
            </div>
          </section>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-white/[0.08] bg-black/15 px-6 py-4 sm:flex-row sm:justify-end sm:px-7">
          <Button
            variant="outline"
            disabled={Boolean(working)}
            onClick={deny}
            className="border-red-300/15 bg-red-400/[0.04] text-red-200 hover:bg-red-400/10 hover:text-red-100"
          >
            {working === "deny" ? (
              <Spinner className="size-4" />
            ) : (
              <X size={15} />
            )}
            {zh ? "拒绝请求" : "Deny request"}
          </Button>
          <Button
            disabled={Boolean(working)}
            onClick={approve}
            className="bg-violet-500 font-bold hover:bg-violet-400"
          >
            {working === "approve" ? (
              <Spinner className="size-4" />
            ) : (
              <Check size={15} />
            )}
            {zh ? "验证并加密导入" : "Verify and import"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
