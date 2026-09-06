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
import { Spinner } from "@/components/ui/spinner";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TotpSetupView, UnlockView, VaultStatus } from "@/lib/types";
import { vaultApi } from "@/lib/vaultApi";
import {
  ArrowLeft,
  Check,
  Keyboard,
  KeyRound,
  Lock,
  QrCode,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
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
  const { t } = useLanguage();
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
  const [resetOpen, setResetOpen] = useState(false);
  const [hello, setHello] = useState<
    "available" | "notConfigured" | "unavailable" | null
  >(null);
  const [resetPhrase, setResetPhrase] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetDone, setResetDone] = useState<string | null>(null);

  const fail = (message: string) => toast.error(message);

  // After a successful reset the vault file is gone; a reload re-runs
  // get_vault_status and the screen naturally lands on initialization.
  useEffect(() => {
    if (!resetDone) return;
    const timeout = window.setTimeout(() => window.location.reload(), 3200);
    return () => window.clearTimeout(timeout);
  }, [resetDone]);

  async function openReset() {
    setResetPhrase("");
    setResetDone(null);
    setResetOpen(true);
    setHello(null);
    try {
      setHello(await vaultApi.checkWindowsHello());
    } catch {
      setHello("unavailable");
    }
  }

  async function runReset(phrase?: string) {
    setResetBusy(true);
    try {
      const outcome = await vaultApi.resetVault(phrase ?? null);
      setResetDone(outcome.backupPath);
    } catch (error) {
      fail(String(error));
    } finally {
      setResetBusy(false);
    }
  }

  async function beginSetup() {
    if (password.length < 12) return fail(t.auth.passwordTooShort);
    if (password !== confirmPassword) return fail(t.auth.passwordMismatch);
    setProcessing(true);
    try {
      await vaultApi.beginInitialization(password);
      setPassword("");
      setConfirmPassword("");
      setSetupStage("method");
    } catch {
      fail(t.auth.beginSetupFailed);
    } finally {
      setProcessing(false);
    }
  }

  async function finishPasswordOnly() {
    setProcessing(true);
    try {
      const view = await vaultApi.completePasswordInitialization();
      toast.success(t.auth.vaultCreated);
      onUnlocked(view);
    } catch {
      fail(t.auth.vaultCreateFailed);
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
      fail(t.auth.qrGenerateFailed);
    } finally {
      setProcessing(false);
    }
  }

  async function confirmTotp() {
    if (!/^\d{6}$/.test(totpCode)) return fail(t.auth.enterSixDigits);
    setProcessing(true);
    try {
      const view = await vaultApi.confirmInitialTotp(totpCode);
      toast.success(t.auth.quickEnabled);
      setTotpSetup(null);
      onUnlocked(view);
    } catch {
      fail(t.auth.totpInvalid);
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
      return fail(t.auth.enterSixDigits);
    }
    if (unlockMethod === "password" && !password)
      return fail(t.auth.enterMasterPassword);
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
        unlockMethod === "totp" ? t.auth.totpUnlockFailed : t.auth.unlockFailed
      );
    } finally {
      setProcessing(false);
    }
  }

  const busyIcon = processing ? <Spinner className="size-4" /> : null;

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
          <p className="mt-0.5 text-[10px] text-zinc-600">{t.app.tagline}</p>
        </div>
      </header>

      <section className="relative z-10 w-full max-w-[540px] rounded-lg border border-white/[0.1] bg-[#111116]/95 p-5 shadow-2xl backdrop-blur-xl sm:p-7">
        <div className="mb-6 flex items-center justify-between border-b border-white/[0.08] pb-4">
          <span className="inline-flex items-center gap-2 text-xs font-bold text-violet-200">
            <ShieldCheck size={15} /> {t.auth.onDeviceVault}
          </span>
          <span className="text-[10px] text-zinc-600">
            {status.hasVault
              ? t.auth.locked
              : setupStage === "password"
                ? "01 / 02"
                : "02 / 02"}
          </span>
        </div>

        {!status.hasVault && setupStage === "password" && (
          <div>
            <h1 className="text-2xl font-extrabold">{t.auth.initTitle}</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
              {t.auth.initHint}
            </p>
            <div className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="setup-password">{t.auth.masterPassword}</Label>
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
                <Label htmlFor="setup-confirm">
                  {t.auth.confirmMasterPassword}
                </Label>
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
                {busyIcon}
                {t.auth.continue}
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
              <ArrowLeft size={14} /> {t.auth.backToPassword}
            </button>
            <h1 className="text-2xl font-extrabold">
              {t.auth.chooseMethodTitle}
            </h1>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
              {t.auth.chooseMethodHint}
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                disabled={processing}
                onClick={finishPasswordOnly}
                className="min-h-[154px] rounded-lg border border-white/[0.1] bg-white/[0.025] p-5 text-left hover:border-violet-300/50 hover:bg-violet-400/[0.05]"
              >
                <Keyboard className="text-zinc-400" size={23} />
                <strong className="mt-8 block text-sm">
                  {t.auth.passwordOnly}
                </strong>
                <span className="mt-1.5 block text-xs leading-5 text-zinc-600">
                  {t.auth.passwordOnlyHint}
                </span>
              </button>
              <button
                disabled={processing}
                onClick={openTotpSetup}
                className="min-h-[154px] rounded-lg border border-violet-400/45 bg-violet-400/[0.07] p-5 text-left hover:border-violet-300"
              >
                <QrCode className="text-violet-300" size={23} />
                <strong className="mt-8 block text-sm">
                  {t.auth.addQuick2fa}
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
            <h1 className="text-2xl font-extrabold">{t.auth.unlockTitle}</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-500">
              {t.auth.unlockHint}
            </p>
            {status.quickUnlockEnabled && (
              <div className="mt-6 grid grid-cols-2 rounded-lg border border-white/[0.08] bg-black/25 p-1">
                <button
                  onClick={() => setUnlockMethod("totp")}
                  className={`h-9 rounded-md text-xs font-bold ${unlockMethod === "totp" ? "bg-violet-500 text-white" : "text-zinc-500 hover:text-white"}`}
                >
                  {t.auth.totpSignIn}
                </button>
                <button
                  onClick={() => setUnlockMethod("password")}
                  className={`h-9 rounded-md text-xs font-bold ${unlockMethod === "password" ? "bg-white/[0.09] text-white" : "text-zinc-500 hover:text-white"}`}
                >
                  {t.auth.passwordSignIn}
                </button>
              </div>
            )}
            <div className="mt-5 space-y-4">
              {unlockMethod === "totp" && status.quickUnlockEnabled ? (
                <div className="space-y-2">
                  <Label htmlFor="unlock-totp">{t.auth.sixDigitCode}</Label>
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
                  <Label htmlFor="unlock-password">
                    {t.auth.masterPassword}
                  </Label>
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
                    {t.auth.verifyAndUnlock}
                  </>
                ) : (
                  <>
                    <Lock size={16} />
                    {t.auth.unlockVault}
                  </>
                )}
              </Button>
              <button
                onClick={openReset}
                className="w-full text-center text-xs text-zinc-600 transition hover:text-zinc-300"
              >
                {t.auth.forgotPassword}
              </button>
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
            <DialogTitle>{t.auth.scanTitle}</DialogTitle>
            <DialogDescription>{t.auth.scanHint}</DialogDescription>
          </DialogHeader>
          {totpSetup && (
            <div className="grid gap-5 pt-2 sm:grid-cols-[184px_1fr] sm:items-center">
              <img
                src={totpSetup.qrDataUrl}
                alt={t.auth.qrAlt}
                className="mx-auto h-[184px] w-[184px] rounded-md border-8 border-white bg-white object-contain"
              />
              <div className="min-w-0 space-y-3">
                <Label htmlFor="setup-totp">{t.auth.authenticatorCode}</Label>
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
                  {busyIcon}
                  {t.auth.verifyAndFinish}
                </Button>
                <button
                  onClick={() => setManualSecretVisible(visible => !visible)}
                  className="w-full text-center text-xs text-zinc-500 hover:text-white"
                >
                  {t.auth.cannotScan}{" "}
                  {manualSecretVisible ? t.auth.hideKey : t.auth.showKey}
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
            {t.auth.finishWithPassword}
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog
        open={resetOpen}
        onOpenChange={open => {
          if (!resetBusy) setResetOpen(open);
        }}
      >
        <DialogContent className="max-w-md border-white/[0.1] bg-[#141419] text-white sm:rounded-lg">
          {resetDone ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto grid size-12 place-items-center rounded-full border border-violet-300/25 bg-violet-500/10">
                <ShieldCheck className="size-6 text-violet-200" />
              </div>
              <DialogHeader className="items-center text-center sm:text-center">
                <DialogTitle>{t.auth.resetDoneTitle}</DialogTitle>
                <DialogDescription className="text-left">
                  {t.auth.resetBackupSaved}
                  <span className="mt-1 block break-all text-zinc-300">
                    {resetDone}
                  </span>
                  {t.auth.resetRestoreHint}
                </DialogDescription>
              </DialogHeader>
              <p className="text-xs text-zinc-500">{t.auth.returningToSetup}</p>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t.auth.resetTitle}</DialogTitle>
                <DialogDescription>{t.auth.resetWarning}</DialogDescription>
              </DialogHeader>
              <ul className="space-y-1.5 rounded-lg border border-white/[0.08] bg-black/25 p-3 text-xs leading-5 text-zinc-400">
                <li>· {t.auth.resetBullet1}</li>
                <li>· {t.auth.resetBullet2}</li>
                <li>· {t.auth.resetBullet3}</li>
              </ul>
              {hello === null && (
                <div className="flex items-center justify-center gap-2 py-2 text-xs text-zinc-500">
                  <Spinner className="size-4" /> {t.auth.checkingHello}
                </div>
              )}
              {hello === "available" && (
                <div className="space-y-3">
                  <p className="text-xs leading-5 text-zinc-400">
                    {t.auth.helloPrompt}
                  </p>
                  <Button
                    disabled={resetBusy}
                    onClick={() => runReset()}
                    className="w-full bg-red-500 font-bold hover:bg-red-400"
                  >
                    {resetBusy ? (
                      <Spinner className="size-4" />
                    ) : (
                      <ShieldAlert size={15} className="mr-2" />
                    )}
                    {t.auth.helloReset}
                  </Button>
                </div>
              )}
              {(hello === "notConfigured" || hello === "unavailable") && (
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="reset-phrase">
                      {t.auth.noHelloLabel.replace(
                        "{phrase}",
                        t.auth.resetPhrase
                      )}
                    </Label>
                    <Input
                      id="reset-phrase"
                      autoFocus
                      value={resetPhrase}
                      onChange={event => setResetPhrase(event.target.value)}
                      onKeyDown={event =>
                        event.key === "Enter" &&
                        resetPhrase.trim() === t.auth.resetPhrase &&
                        runReset(resetPhrase)
                      }
                      placeholder={t.auth.resetPhrase}
                      className="mt-2 h-11 border-white/10 bg-white/[0.05]"
                    />
                  </div>
                  <Button
                    disabled={
                      resetBusy || resetPhrase.trim() !== t.auth.resetPhrase
                    }
                    onClick={() => runReset(resetPhrase)}
                    className="w-full bg-red-500 font-bold hover:bg-red-400"
                  >
                    {resetBusy ? (
                      <Spinner className="size-4" />
                    ) : (
                      <ShieldAlert size={15} className="mr-2" />
                    )}
                    {t.auth.confirmReset}
                  </Button>
                </div>
              )}
              <Button
                variant="ghost"
                disabled={resetBusy}
                onClick={() => setResetOpen(false)}
                className="text-zinc-500 hover:text-white"
              >
                {t.auth.cancel}
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
