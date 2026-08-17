import VaultMark from "@/components/VaultMark";
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
import type { TotpSetupView, UnlockView, VaultStatus } from "@/lib/types";
import { vaultApi } from "@/lib/vaultApi";
import {
  ArrowLeft,
  Check,
  Keyboard,
  KeyRound,
  LoaderCircle,
  Lock,
  QrCode,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const LOCKSCAPE = "./assets/github-vault-lockscape_04ecc033.jpg";

type SetupStage = "password" | "method";
type UnlockMethod = "totp" | "password";

export default function AuthScreen({
  status,
  onUnlocked,
}: {
  status: VaultStatus;
  onUnlocked: (view: UnlockView) => void;
}) {
  const [setupStage, setSetupStage] = useState<SetupStage>("password");
  const [unlockMethod, setUnlockMethod] = useState<UnlockMethod>(
    status.quickUnlockEnabled ? "totp" : "password"
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [totpSetup, setTotpSetup] = useState<TotpSetupView | null>(null);
  const [manualSecretVisible, setManualSecretVisible] = useState(false);
  const [processing, setProcessing] = useState(false);

  const fail = (message: string) => toast.error(message);

  async function beginSetup() {
    if (password.length < 12) return fail("主密码至少应包含 12 位字符。");
    if (password !== confirmPassword) return fail("两次输入的主密码不一致。");
    setProcessing(true);
    try {
      await vaultApi.beginInitialization(password);
      setPassword("");
      setConfirmPassword("");
      setSetupStage("method");
    } catch {
      fail("无法开始初始化，请检查主密码后重试。");
    } finally {
      setProcessing(false);
    }
  }

  async function finishPasswordOnly() {
    setProcessing(true);
    try {
      const view = await vaultApi.completePasswordInitialization();
      toast.success("加密保管库已创建。");
      onUnlocked(view);
    } catch {
      fail("无法创建保管库，请重试。");
    } finally {
      setProcessing(false);
    }
  }

  async function openTotpSetup() {
    setProcessing(true);
    try {
      setTotpSetup(await vaultApi.beginInitialTotp());
      setTotpCode("");
    } catch {
      fail("无法生成验证二维码，请重试。");
    } finally {
      setProcessing(false);
    }
  }

  async function confirmTotp() {
    if (!/^\d{6}$/.test(totpCode)) return fail("请输入 6 位动态验证码。");
    setProcessing(true);
    try {
      const view = await vaultApi.confirmInitialTotp(totpCode);
      toast.success("2FA 快速登录已启用。");
      setTotpSetup(null);
      onUnlocked(view);
    } catch {
      fail("验证码无效或已过期，请输入当前验证码。");
    } finally {
      setProcessing(false);
    }
  }

  async function backToPasswordSetup() {
    await vaultApi.cancelInitialization().catch(() => undefined);
    setSetupStage("password");
  }

  async function unlock() {
    if (unlockMethod === "totp" && !/^\d{6}$/.test(totpCode)) {
      return fail("请输入 6 位动态验证码。");
    }
    if (unlockMethod === "password" && !password) return fail("请输入主密码。");
    setProcessing(true);
    try {
      const view =
        unlockMethod === "totp"
          ? await vaultApi.unlockWithTotp(totpCode)
          : await vaultApi.unlockWithPassword(password);
      setPassword("");
      setTotpCode("");
      onUnlocked(view);
    } catch {
      fail(
        unlockMethod === "totp"
          ? "验证码无效、已使用或当前处于冷却时间，可切换主密码登录。"
          : "无法解锁，请检查主密码。"
      );
    } finally {
      setProcessing(false);
    }
  }

  const busyIcon = processing ? (
    <LoaderCircle className="animate-spin" size={16} />
  ) : null;

  return (
    <main className="screen-fill relative grid place-items-center overflow-hidden bg-[#08080a] px-4 py-16 text-white sm:px-8">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-25"
        style={{ backgroundImage: `url(${LOCKSCAPE})` }}
      />
      <div className="grain absolute inset-0 opacity-20" />
      <div className="absolute inset-0 bg-black/70" />

      <header className="absolute left-5 top-5 z-10 flex items-center gap-3 sm:left-9 sm:top-8">
        <VaultMark className="h-11 w-11" />
        <div>
          <p className="text-sm font-extrabold">Github Auth</p>
          <p className="mt-0.5 text-[10px] text-zinc-600">本地加密索引</p>
        </div>
      </header>

      <section className="relative z-10 w-full max-w-[540px] rounded-lg border border-white/[0.1] bg-[#111116]/95 p-5 shadow-2xl backdrop-blur-xl sm:p-7">
        <div className="mb-6 flex items-center justify-between border-b border-white/[0.08] pb-4">
          <span className="inline-flex items-center gap-2 text-xs font-bold text-violet-200">
            <ShieldCheck size={15} /> 本机安全保管库
          </span>
          <span className="text-[10px] text-zinc-600">
            {status.hasVault
              ? "已锁定"
              : setupStage === "password"
                ? "01 / 02"
                : "02 / 02"}
          </span>
        </div>

        {!status.hasVault && setupStage === "password" && (
          <div>
            <h1 className="text-2xl font-extrabold">初始化本地账户索引</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
              设置至少 12 位主密码。主密码不会保存，也无法恢复。
            </p>
            <div className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="setup-password">主密码</Label>
                <Input
                  id="setup-password"
                  autoFocus
                  type="password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  className="h-11 border-white/10 bg-white/[0.05]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup-confirm">确认主密码</Label>
                <Input
                  id="setup-confirm"
                  type="password"
                  value={confirmPassword}
                  onChange={event => setConfirmPassword(event.target.value)}
                  onKeyDown={event => event.key === "Enter" && beginSetup()}
                  className="h-11 border-white/10 bg-white/[0.05]"
                />
              </div>
              <Button
                disabled={processing}
                onClick={beginSetup}
                className="h-11 w-full bg-violet-500 font-bold hover:bg-violet-400"
              >
                {busyIcon}继续
              </Button>
            </div>
          </div>
        )}

        {!status.hasVault && setupStage === "method" && (
          <div>
            <button
              onClick={backToPasswordSetup}
              className="mb-4 inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-white"
            >
              <ArrowLeft size={14} /> 返回修改主密码
            </button>
            <h1 className="text-2xl font-extrabold">选择登录方式</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
              主密码始终可用；2FA 是绑定当前 Windows 用户的快速登录方式。
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                disabled={processing}
                onClick={finishPasswordOnly}
                className="min-h-[154px] rounded-lg border border-white/[0.1] bg-white/[0.025] p-5 text-left hover:border-violet-300/50 hover:bg-violet-400/[0.05]"
              >
                <Keyboard className="text-zinc-400" size={23} />
                <strong className="mt-8 block text-sm">仅使用密码登录</strong>
                <span className="mt-1.5 block text-xs leading-5 text-zinc-600">
                  无需绑定当前设备
                </span>
              </button>
              <button
                disabled={processing}
                onClick={openTotpSetup}
                className="min-h-[154px] rounded-lg border border-violet-400/45 bg-violet-400/[0.07] p-5 text-left hover:border-violet-300"
              >
                <QrCode className="text-violet-300" size={23} />
                <strong className="mt-8 block text-sm">
                  添加 2FA 快速登录
                </strong>
                <span className="mt-1.5 block text-xs leading-5 text-violet-200/60">
                  Google Authenticator
                </span>
              </button>
            </div>
          </div>
        )}

        {status.hasVault && (
          <div>
            <h1 className="text-2xl font-extrabold">解锁本地账户索引</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
              凭据仅在当前设备解密，不会上传。
            </p>
            {status.quickUnlockEnabled && (
              <div className="mt-6 grid grid-cols-2 rounded-lg border border-white/[0.08] bg-black/25 p-1">
                <button
                  onClick={() => setUnlockMethod("totp")}
                  className={`h-9 rounded-md text-xs font-bold ${unlockMethod === "totp" ? "bg-violet-500 text-white" : "text-zinc-500 hover:text-white"}`}
                >
                  验证码快速登录
                </button>
                <button
                  onClick={() => setUnlockMethod("password")}
                  className={`h-9 rounded-md text-xs font-bold ${unlockMethod === "password" ? "bg-white/[0.09] text-white" : "text-zinc-500 hover:text-white"}`}
                >
                  主密码登录
                </button>
              </div>
            )}
            <div className="mt-5 space-y-4">
              {unlockMethod === "totp" && status.quickUnlockEnabled ? (
                <div className="space-y-2">
                  <Label htmlFor="unlock-totp">6 位动态验证码</Label>
                  <Input
                    id="unlock-totp"
                    autoFocus
                    inputMode="numeric"
                    maxLength={6}
                    value={totpCode}
                    onChange={event =>
                      setTotpCode(event.target.value.replace(/\D/g, ""))
                    }
                    onKeyDown={event => event.key === "Enter" && unlock()}
                    className="h-12 border-white/10 bg-white/[0.05] text-center text-lg"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="unlock-password">主密码</Label>
                  <Input
                    id="unlock-password"
                    autoFocus
                    type="password"
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    onKeyDown={event => event.key === "Enter" && unlock()}
                    className="h-12 border-white/10 bg-white/[0.05]"
                  />
                </div>
              )}
              <Button
                disabled={processing}
                onClick={unlock}
                className="h-11 w-full bg-violet-500 font-bold hover:bg-violet-400"
              >
                {busyIcon}
                {unlockMethod === "totp" && status.quickUnlockEnabled ? (
                  <>
                    <Check size={16} />
                    验证并解锁
                  </>
                ) : (
                  <>
                    <Lock size={16} />
                    解锁保管库
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </section>

      <footer className="absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap text-[10px] text-zinc-700">
        <KeyRound size={12} /> Argon2id · AES-256-GCM · Windows DPAPI
      </footer>

      <Dialog
        open={Boolean(totpSetup)}
        onOpenChange={open => !open && setTotpSetup(null)}
      >
        <DialogContent className="max-w-lg border-white/[0.1] bg-[#141419] text-white sm:rounded-lg">
          <DialogHeader>
            <DialogTitle>使用 Google Authenticator 扫描</DialogTitle>
            <DialogDescription>
              扫描后输入当前 6 位验证码，验证成功才会启用快速登录。
            </DialogDescription>
          </DialogHeader>
          {totpSetup && (
            <div className="grid gap-5 pt-2 sm:grid-cols-[184px_1fr] sm:items-center">
              <img
                src={totpSetup.qrDataUrl}
                alt="Google Authenticator 二维码"
                className="mx-auto h-[184px] w-[184px] rounded-md border-8 border-white bg-white object-contain"
              />
              <div className="min-w-0 space-y-3">
                <Label htmlFor="setup-totp">动态验证码</Label>
                <Input
                  id="setup-totp"
                  autoFocus
                  inputMode="numeric"
                  maxLength={6}
                  value={totpCode}
                  onChange={event =>
                    setTotpCode(event.target.value.replace(/\D/g, ""))
                  }
                  onKeyDown={event => event.key === "Enter" && confirmTotp()}
                  className="h-11 text-center text-base"
                />
                <Button
                  disabled={processing}
                  onClick={confirmTotp}
                  className="w-full bg-violet-500 font-bold hover:bg-violet-400"
                >
                  {busyIcon}验证并完成
                </Button>
                <button
                  onClick={() => setManualSecretVisible(visible => !visible)}
                  className="w-full text-center text-xs text-zinc-500 hover:text-white"
                >
                  无法扫描？{manualSecretVisible ? "隐藏" : "显示"}设置密钥
                </button>
                {manualSecretVisible && (
                  <p className="break-all rounded-md bg-black/30 p-2 text-center text-[11px] text-zinc-400">
                    {totpSetup.manualSecret}
                  </p>
                )}
              </div>
            </div>
          )}
          <Button
            variant="ghost"
            onClick={finishPasswordOnly}
            className="text-zinc-500 hover:text-white"
          >
            仅使用密码完成初始化
          </Button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
