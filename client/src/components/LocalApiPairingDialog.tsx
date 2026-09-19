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
import type { PendingPairing, VaultPayload } from "@/lib/types";
import { vaultApi } from "@/lib/vaultApi";
import {
  Check,
  FileWarning,
  Fingerprint,
  Folder,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Props = {
  request: PendingPairing | null;
  quickUnlockEnabled: boolean;
  onApproved: (payload: VaultPayload) => void;
  onDenied: () => void;
};

export default function LocalApiPairingDialog({
  request,
  quickUnlockEnabled,
  onApproved,
  onDenied,
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
    if (!request || !credential.trim()) {
      return toast.error(
        zh ? "请输入安全验证信息。" : "Enter your verification credential."
      );
    }
    setWorking("approve");
    try {
      onApproved(
        await vaultApi.approveLocalApiPairing(
          request.id,
          quickUnlockEnabled ? "totp" : "password",
          credential.trim()
        )
      );
      toast.success(zh ? "客户端已配对。" : "Client paired.");
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
      await vaultApi.denyLocalApiPairing(request.id);
      onDenied();
      toast.info(zh ? "已拒绝配对请求。" : "Pairing request denied.");
    } catch (error) {
      toast.error(String(error));
    } finally {
      setWorking(null);
    }
  }

  const unverified = request.signatureStatus !== "verified";

  return (
    <Dialog open>
      <DialogContent
        className="max-h-[92vh] max-w-2xl overflow-hidden border-white/[0.11] bg-[#111116] p-0 text-white shadow-[0_30px_100px_rgba(0,0,0,0.65)] sm:rounded-3xl"
        onEscapeKeyDown={event => event.preventDefault()}
        onPointerDownOutside={event => event.preventDefault()}
      >
        <div className="border-b border-white/[0.08] bg-[radial-gradient(circle_at_top_right,rgba(168,85,247,0.16),transparent_45%)] px-6 py-5">
          <DialogHeader>
            <div className="flex items-start gap-4">
              <div className="grid size-14 shrink-0 place-items-center rounded-2xl border border-violet-300/20 bg-violet-400/10 text-violet-200">
                <Fingerprint size={24} />
              </div>
              <div className="min-w-0">
                <DialogTitle className="break-words text-xl font-black">
                  {zh
                    ? `${request.application.name} 请求配对`
                    : `${request.application.name} requests pairing`}
                </DialogTitle>
                <DialogDescription className="mt-1 break-words text-zinc-400">
                  {request.application.developer}
                </DialogDescription>
              </div>
            </div>
            <p className="mt-4 rounded-xl border border-white/[0.07] bg-black/20 px-4 py-3 text-sm leading-6 text-zinc-400">
              {request.application.description}
            </p>
            <p className="mt-2 rounded-xl border border-violet-300/10 bg-violet-300/[0.04] px-4 py-3 text-sm leading-6 text-zinc-300">
              {zh ? "本次用途：" : "Purpose: "}
              {request.purpose}
            </p>
          </DialogHeader>
        </div>

        <div className="max-h-[55vh] space-y-4 overflow-y-auto px-6 py-5">
          <div
            className={`rounded-2xl border p-4 ${
              unverified
                ? "border-amber-300/20 bg-amber-300/[0.05]"
                : "border-emerald-300/20 bg-emerald-300/[0.05]"
            }`}
          >
            <p className="flex items-center gap-2 text-sm font-bold">
              {unverified ? (
                <ShieldAlert size={16} />
              ) : (
                <ShieldCheck size={16} />
              )}
              {unverified
                ? zh
                  ? "调用方自报信息，未验证可执行程序"
                  : "Caller-supplied identity; executable not verified"
                : zh
                  ? "已验证可执行程序"
                  : "Executable verified"}
            </p>
            <dl className="mt-3 grid gap-2 text-xs text-zinc-500 sm:grid-cols-[130px_1fr]">
              <dt>{zh ? "可执行文件" : "Executable"}</dt>
              <dd className="break-all text-zinc-300">
                {request.executablePath || (zh ? "未提供" : "Not provided")}
              </dd>
              <dt>SHA-256</dt>
              <dd className="break-all text-zinc-300">
                {request.executableSha256 || (zh ? "未验证" : "Unverified")}
              </dd>
              <dt>{zh ? "签名发布者" : "Publisher"}</dt>
              <dd className="break-all text-zinc-300">
                {request.authenticodePublisher ||
                  (zh ? "未验证" : "Unverified")}
              </dd>
              <dt>{zh ? "来源" : "Source"}</dt>
              <dd className="text-zinc-300">
                {request.remoteAddress}
                {request.sourcePid ? ` · PID ${request.sourcePid}` : ""}
              </dd>
            </dl>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
              <p className="flex items-center gap-2 text-xs font-bold text-zinc-500">
                <KeyRound size={14} /> {zh ? "请求权限" : "Permissions"}
              </p>
              <p className="mt-2 text-sm font-bold">
                {[
                  request.allowImport ? (zh ? "导入" : "Import") : null,
                  request.allowRead ? (zh ? "读取" : "Read") : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
              <p className="flex items-center gap-2 text-xs font-bold text-zinc-500">
                <Folder size={14} /> {zh ? "读取分组" : "Read scope"}
              </p>
              <p className="mt-2 break-words text-sm font-bold">
                {request.groupName ?? (zh ? "不请求读取" : "No read access")}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-red-300/15 bg-red-300/[0.04] p-4 text-xs leading-5 text-red-100/70">
            <FileWarning size={14} className="mr-2 inline" />
            {zh
              ? "软件名称、开发者和图标可以伪造。未显示“已验证”时，请只在你主动启动并确认来源的程序上批准。"
              : "Names, developers and icons can be spoofed. Approve an unverified caller only when you intentionally launched and recognize it."}
          </div>

          <div>
            <Label htmlFor="pairing-credential">
              {quickUnlockEnabled
                ? zh
                  ? "输入当前 2FA 验证码"
                  : "Current 2FA code"
                : zh
                  ? "输入当前主密码"
                  : "Current master password"}
            </Label>
            <Input
              id="pairing-credential"
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
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-white/[0.08] bg-black/15 px-6 py-4 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={Boolean(working)} onClick={deny}>
            {working === "deny" ? (
              <Spinner className="size-4" />
            ) : (
              <X size={15} />
            )}
            {zh ? "拒绝" : "Deny"}
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
            {zh ? "验证并签发证书" : "Verify and issue certificate"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
