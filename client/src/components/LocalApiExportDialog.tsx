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
import { Spinner } from "@/components/ui/spinner";
import { useLanguage } from "@/contexts/LanguageContext";
import type { PendingApiExport, VaultPayload } from "@/lib/types";
import { vaultApi } from "@/lib/vaultApi";
import {
  Check,
  Folder,
  KeyRound,
  Mail,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Props = {
  request: PendingApiExport | null;
  quickUnlockEnabled: boolean;
  onResolved: (payload: VaultPayload) => void;
};

function ApplicationIcon({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="grid size-14 shrink-0 place-items-center rounded-2xl border border-sky-300/20 bg-sky-400/10 text-xl font-black text-sky-200">
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

export default function LocalApiExportDialog({
  request,
  quickUnlockEnabled,
  onResolved,
}: Props) {
  const { language } = useLanguage();
  const zh = language.startsWith("zh");
  const [credential, setCredential] = useState("");
  const [working, setWorking] = useState<"approve" | "deny" | null>(null);

  useEffect(() => {
    setCredential("");
    setWorking(null);
  }, [request?.id]);

  if (!request) return null;

  async function approve() {
    if (!request) return;
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
      onResolved(
        await vaultApi.approveLocalApiExport(
          request.id,
          quickUnlockEnabled ? "totp" : "password",
          credential.trim()
        )
      );
      toast.success(
        zh ? "已允许本次分组读取。" : "This group read was approved."
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
      onResolved(await vaultApi.denyLocalApiExport(request.id));
      toast.info(zh ? "已拒绝账户读取请求。" : "Account read denied.");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setWorking(null);
    }
  }

  return (
    <Dialog open>
      <DialogContent
        className="max-h-[92vh] max-w-3xl overflow-hidden border-white/[0.11] bg-[#111116] p-0 text-white shadow-[0_30px_100px_rgba(0,0,0,0.65)] sm:rounded-3xl"
        onEscapeKeyDown={event => event.preventDefault()}
        onPointerDownOutside={event => event.preventDefault()}
      >
        <div className="border-b border-white/[0.08] bg-[radial-gradient(circle_at_top_right,rgba(56,189,248,0.15),transparent_42%)] px-6 py-5 sm:px-7">
          <DialogHeader>
            <div className="mb-4 flex items-start gap-4">
              <ApplicationIcon
                src={request.application.icon}
                name={request.application.name}
              />
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-sky-200">
                    {zh ? "敏感读取请求" : "Sensitive read request"}
                  </span>
                  <span className="text-xs text-zinc-600">
                    {new Date(request.requestedAt).toLocaleString(language)}
                  </span>
                </div>
                <DialogTitle className="text-xl font-black tracking-[-0.03em] sm:text-2xl">
                  {zh
                    ? `${request.application.name} 请求读取 Github 账户`
                    : `${request.application.name} wants to read GitHub accounts`}
                </DialogTitle>
                <DialogDescription className="mt-1.5 text-sm text-zinc-400">
                  {zh ? "开发者" : "Developer"}：{request.application.developer}
                </DialogDescription>
              </div>
            </div>
            <p className="rounded-xl border border-white/[0.07] bg-black/20 px-4 py-3 text-sm leading-6 text-zinc-400">
              {request.application.description}
            </p>
          </DialogHeader>
        </div>

        <div className="no-scrollbar max-h-[55vh] overflow-y-auto px-6 py-5 sm:px-7">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-4">
              <p className="flex items-center gap-2 text-xs font-bold text-zinc-500">
                <Folder size={14} />{" "}
                {zh ? "API Key 允许的分组" : "API key scope"}
              </p>
              <p className="mt-2 text-lg font-black">{request.groupName}</p>
              <p className="mt-1 text-xs text-zinc-600">{request.apiKeyName}</p>
            </div>
            <div className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.045] p-4">
              <p className="flex items-center gap-2 text-xs font-bold text-amber-200/70">
                <ShieldAlert size={14} />{" "}
                {zh ? "将返回的敏感字段" : "Sensitive fields returned"}
              </p>
              <p className="mt-2 text-sm font-bold text-amber-100">
                {zh
                  ? "账户名、邮箱、密码、2FA 密钥与备注"
                  : "Names, emails, passwords, 2FA secrets and notes"}
              </p>
              <p className="mt-1 text-xs text-amber-100/45">
                {zh
                  ? "只允许本次请求"
                  : "Approval applies to this request only"}
              </p>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold">
                {zh ? "请求读取的账户" : "Accounts requested"}
              </p>
              <p className="mt-1 text-xs text-zinc-600">
                {zh
                  ? `共 ${request.accounts.length} 个账户，不在此分组的账户不会返回。`
                  : `${request.accounts.length} account(s). Accounts outside this group cannot be returned.`}
              </p>
            </div>
            <span className="mono rounded-lg bg-sky-400/10 px-2.5 py-1 text-xs text-sky-200">
              {request.accounts.length}
            </span>
          </div>

          <div className="mt-3 space-y-2">
            {request.accounts.map((account, index) => (
              <article
                key={`${account.name}-${account.email}-${index}`}
                className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-black/15 px-4 py-3"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-zinc-500">
                  <UserRound size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{account.name}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-zinc-600">
                    <Mail size={11} /> {account.email}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {account.hasPassword && (
                    <span className="rounded bg-white/[0.05] px-1.5 py-1 text-[9px] font-bold text-zinc-500">
                      PASSWORD
                    </span>
                  )}
                  {account.hasTotp && (
                    <span className="rounded bg-emerald-400/10 px-1.5 py-1 text-[9px] font-bold text-emerald-300">
                      2FA
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>

          <div className="mt-5 border-t border-white/[0.08] pt-5">
            <Label htmlFor="local-api-export-credential">
              {quickUnlockEnabled
                ? zh
                  ? "输入当前 2FA 验证码，仅允许本次读取"
                  : "Enter the current 2FA code for this read only"
                : zh
                  ? "输入当前主密码，仅允许本次读取"
                  : "Enter the current master password for this read only"}
            </Label>
            <Input
              id="local-api-export-credential"
              autoFocus
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
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-600">
              <ShieldCheck size={12} />
              {zh
                ? "API Key 决定可请求的分组；你的验证决定是否允许这一笔请求。"
                : "The API key limits the group; your verification approves this one request."}
            </p>
          </div>
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
            {zh ? "拒绝读取" : "Deny read"}
          </Button>
          <Button
            disabled={Boolean(working)}
            onClick={approve}
            className="bg-sky-500 font-bold hover:bg-sky-400"
          >
            {working === "approve" ? (
              <Spinner className="size-4" />
            ) : (
              <Check size={15} />
            )}
            {zh ? "验证并允许本次读取" : "Verify and allow once"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
