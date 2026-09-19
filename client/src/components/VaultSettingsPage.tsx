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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type {
  AppLanguage,
  BackupSettings,
  ImportMode,
  ImportPreview,
  TotpSetupView,
  VaultPayload,
  VaultSettings,
} from "@/lib/types";
import { useLanguage } from "@/contexts/LanguageContext";
import { useScreenCaptureProtection } from "@/contexts/ScreenCaptureProtectionContext";
import { getScreenCaptureMessages } from "@/lib/i18n/screenCapture";
import { vaultApi } from "@/lib/vaultApi";
import {
  ArchiveRestore,
  ArrowLeft,
  Check,
  Copy,
  FileArchive,
  FolderOpen,
  HardDriveDownload,
  KeyRound,
  Languages,
  QrCode,
  RotateCcw,
  ScreenShareOff,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Props = {
  onBack: () => void;
  settings: VaultSettings;
  quickUnlockEnabled: boolean;
  onSavePreferences: (settings: VaultSettings) => Promise<void>;
  onQuickUnlockChange: (enabled: boolean) => void;
  onImported: (payload: VaultPayload) => void;
};

/* Vault settings as a standalone section page (Veil-style), not a modal. */
export default function VaultSettingsPage({
  onBack,
  settings,
  quickUnlockEnabled,
  onSavePreferences,
  onQuickUnlockChange,
  onImported,
}: Props) {
  const { language, languages, t: dictionary, setLanguage } = useLanguage();
  const t = dictionary.settings;
  const captureProtection = useScreenCaptureProtection();
  const captureMessages = getScreenCaptureMessages(language);
  const [preferences, setPreferences] = useState(settings);
  const [passwordChange, setPasswordChange] = useState({
    current: "",
    next: "",
    confirm: "",
  });
  const [quickPassword, setQuickPassword] = useState("");
  const [totpSetup, setTotpSetup] = useState<TotpSetupView | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [backupSettings, setBackupSettings] = useState<BackupSettings | null>(
    null
  );
  const [working, setWorking] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importPath, setImportPath] = useState("");
  const [backupPassword, setBackupPassword] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mode, setMode] = useState<ImportMode>("add");
  const [backupCurrent, setBackupCurrent] = useState(true);
  const [currentPassword, setCurrentPassword] = useState("");

  useEffect(() => {
    setPreferences(settings);
    vaultApi
      .getBackupSettings()
      .then(setBackupSettings)
      .catch(() => toast.error(t.operationFailed));
  }, [settings, t.operationFailed]);

  async function saveAll() {
    if (!backupSettings) return;
    setWorking("save");
    try {
      await onSavePreferences(preferences);
      setBackupSettings(await vaultApi.updateBackupSettings(backupSettings));
      toast.success(t.saved);
      onBack();
    } catch {
      toast.error(t.operationFailed);
    } finally {
      setWorking(null);
    }
  }

  async function changePassword() {
    if (passwordChange.next.length < 12) return toast.error(t.invalidPassword);
    if (passwordChange.next !== passwordChange.confirm)
      return toast.error(t.mismatch);
    setWorking("password");
    try {
      await vaultApi.changeMasterPassword(
        passwordChange.current,
        passwordChange.next
      );
      setPasswordChange({ current: "", next: "", confirm: "" });
      toast.success(t.passwordChanged);
    } catch {
      toast.error(t.wrongPassword);
    } finally {
      setWorking(null);
    }
  }

  async function beginQuickSetup() {
    if (!quickPassword) return toast.error(t.quickPasswordHint);
    setWorking("quick");
    try {
      setTotpSetup(await vaultApi.beginTotpRebind(quickPassword));
      setTotpCode("");
    } catch {
      toast.error(t.wrongPassword);
    } finally {
      setWorking(null);
    }
  }

  async function confirmQuickSetup() {
    if (!/^\d{6}$/.test(totpCode)) return toast.error(t.code);
    setWorking("quick-confirm");
    try {
      await vaultApi.confirmTotpRebind(totpCode);
      setTotpSetup(null);
      setTotpCode("");
      setQuickPassword("");
      onQuickUnlockChange(true);
      toast.success(t.quickEnabledToast);
    } catch {
      toast.error(t.operationFailed);
    } finally {
      setWorking(null);
    }
  }

  async function disableQuickUnlock() {
    if (!quickPassword) return toast.error(t.quickPasswordHint);
    setWorking("quick-disable");
    try {
      await vaultApi.disableTotp(quickPassword);
      setQuickPassword("");
      onQuickUnlockChange(false);
      toast.success(t.quickDisabledToast);
    } catch {
      toast.error(t.wrongPassword);
    } finally {
      setWorking(null);
    }
  }

  async function chooseDirectory() {
    try {
      const directory = await vaultApi.chooseBackupDirectory();
      if (directory && backupSettings)
        setBackupSettings({ ...backupSettings, directory });
    } catch {
      toast.error(t.operationFailed);
    }
  }

  async function manualBackup() {
    setWorking("backup");
    try {
      const path = await vaultApi.createManualBackup();
      if (path) toast.success(t.backupDone);
    } catch {
      toast.error(t.backupFailed);
    } finally {
      setWorking(null);
    }
  }

  function resetImport() {
    setImportPath("");
    setBackupPassword("");
    setPreview(null);
    setMode("add");
    setBackupCurrent(true);
    setCurrentPassword("");
  }

  async function openImport() {
    try {
      const path = await vaultApi.chooseImportBackup();
      if (!path) return;
      resetImport();
      setImportPath(path);
      setImportOpen(true);
    } catch {
      toast.error(t.operationFailed);
    }
  }

  async function closeImport() {
    await vaultApi.cancelBackupImport().catch(() => undefined);
    setImportOpen(false);
    resetImport();
  }

  async function inspectImport() {
    if (!backupPassword) return toast.error(t.backupPassword);
    setWorking("inspect");
    try {
      setPreview(await vaultApi.inspectBackup(importPath, backupPassword));
      setBackupPassword("");
    } catch {
      toast.error(t.backupPasswordError);
    } finally {
      setWorking(null);
    }
  }

  async function commitImport() {
    if (!preview) return;
    if (mode === "replace" && !currentPassword)
      return toast.error(t.currentPasswordAgain);
    setWorking("import");
    try {
      const payload = await vaultApi.commitBackupImport(
        preview.token,
        mode,
        mode === "replace" && backupCurrent,
        mode === "replace" ? currentPassword : undefined
      );
      onImported(payload);
      toast.success(t.importDone);
      await closeImport();
    } catch {
      toast.error(t.importFailed);
    } finally {
      setWorking(null);
    }
  }

  return (
    <>
      <section className="flex h-full min-h-0 flex-1 flex-col bg-[#08080a] text-white">
        <header className="flex shrink-0 items-start gap-3 px-6 pb-4 pt-6">
          <button
            type="button"
            onClick={onBack}
            aria-label={t.back}
            title={t.back}
            className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[9px] text-zinc-400 transition hover:bg-white/[0.06] hover:text-white"
          >
            <ArrowLeft size={17} />
          </button>
          <div>
            <h1 className="flex items-center gap-2 text-lg font-extrabold tracking-[-0.03em]">
              <Settings2 size={18} className="text-violet-300" /> {t.title}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">{t.hint}</p>
          </div>
        </header>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-6">
          <section className="py-5">
            <p className="mb-4 flex items-center gap-2 text-xs font-bold text-zinc-500">
              <Languages size={15} /> {t.preferences}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>{t.language}</Label>
                <Select
                  value={language}
                  onValueChange={(value: AppLanguage) => {
                    // Apply instantly app-wide; the choice is persisted with
                    // the preferences when the user saves.
                    setLanguage(value);
                    setPreferences({ ...preferences, language: value });
                  }}
                >
                  <SelectTrigger className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {languages.map(item => (
                      <SelectItem key={item.code} value={item.code}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t.clipboard}</Label>
                <div className="mt-2 flex items-center gap-3">
                  <Input
                    type="number"
                    min="0"
                    max="120"
                    value={preferences.clipboardClearSeconds}
                    onChange={event =>
                      setPreferences({
                        ...preferences,
                        clipboardClearSeconds: Number(event.target.value),
                      })
                    }
                    className="w-24 text-center"
                  />
                  <span className="text-xs text-zinc-500">
                    {preferences.clipboardClearSeconds ? t.seconds : t.disabled}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="border-t border-white/[0.08] py-5">
            <p className="mb-4 flex items-center gap-2 text-xs font-bold text-zinc-500">
              <ShieldCheck size={15} /> {t.security}
            </p>
            <div className="mb-5 flex items-start justify-between gap-5 rounded-xl border border-white/[0.08] bg-white/[0.025] p-4">
              <div className="flex min-w-0 gap-3">
                <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg border border-violet-300/15 bg-violet-400/[0.07] text-violet-200">
                  <ScreenShareOff size={17} />
                </div>
                <div>
                  <Label
                    htmlFor="screen-capture-protection"
                    className="text-sm font-bold"
                  >
                    {captureMessages.settingTitle}
                  </Label>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    {captureMessages.settingHint}
                  </p>
                  <p
                    className={`mt-2 text-xs ${
                      captureProtection.status === "unavailable"
                        ? "text-amber-300/80"
                        : captureProtection.enabled
                          ? "text-emerald-300/80"
                          : "text-zinc-500"
                    }`}
                  >
                    {captureProtection.status === "unavailable"
                      ? captureMessages.unavailableStatus
                      : captureProtection.status === "applying"
                        ? captureMessages.applyingStatus
                        : captureProtection.enabled
                          ? captureMessages.enabledStatus
                          : captureMessages.disabledStatus}
                  </p>
                </div>
              </div>
              <Switch
                id="screen-capture-protection"
                checked={captureProtection.enabled}
                disabled={
                  captureProtection.status === "applying" ||
                  captureProtection.status === "unavailable"
                }
                onCheckedChange={captureProtection.setEnabled}
                aria-label={captureMessages.settingTitle}
                className="mt-1 shrink-0"
              />
            </div>
            <div className="grid gap-3 lg:grid-cols-3">
              <Input
                type="password"
                value={passwordChange.current}
                onChange={event =>
                  setPasswordChange({
                    ...passwordChange,
                    current: event.target.value,
                  })
                }
                placeholder={t.currentPassword}
              />
              <Input
                type="password"
                value={passwordChange.next}
                onChange={event =>
                  setPasswordChange({
                    ...passwordChange,
                    next: event.target.value,
                  })
                }
                placeholder={t.newPassword}
              />
              <Input
                type="password"
                value={passwordChange.confirm}
                onChange={event =>
                  setPasswordChange({
                    ...passwordChange,
                    confirm: event.target.value,
                  })
                }
                placeholder={t.confirmPassword}
              />
            </div>
            <Button
              variant="outline"
              disabled={working === "password"}
              onClick={changePassword}
              className="mt-3 border-white/[0.12] bg-white/[0.03] text-zinc-200"
            >
              <KeyRound size={15} /> {t.changePassword}
            </Button>

            <div className="mt-5 border-t border-white/[0.08] pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold">{t.quickUnlock}</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {quickUnlockEnabled ? t.quickEnabled : t.quickDisabled}
                  </p>
                </div>
                <span
                  className={`h-2 w-2 rounded-full ${quickUnlockEnabled ? "bg-emerald-400" : "bg-zinc-700"}`}
                />
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Input
                  type="password"
                  value={quickPassword}
                  onChange={event => setQuickPassword(event.target.value)}
                  placeholder={t.quickPasswordHint}
                  className="min-w-0 flex-1"
                />
                <Button
                  variant="outline"
                  disabled={working === "quick"}
                  onClick={beginQuickSetup}
                  className="border-violet-300/20 bg-violet-400/[0.07] text-violet-100"
                >
                  <QrCode size={15} /> {quickUnlockEnabled ? t.rebind : t.bind}
                </Button>
                {quickUnlockEnabled && (
                  <Button
                    variant="outline"
                    disabled={working === "quick-disable"}
                    onClick={disableQuickUnlock}
                    className="border-red-300/15 bg-red-400/[0.05] text-red-200"
                  >
                    <Trash2 size={15} /> {t.disableQuick}
                  </Button>
                )}
              </div>
            </div>
          </section>

          <section className="border-t border-white/[0.08] py-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-xs font-bold text-zinc-500">
                  <ArchiveRestore size={15} /> {t.backup}
                </p>
                <p className="mt-2 text-xs leading-5 text-zinc-600">
                  {t.runtimeOnly}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="auto-backup" className="text-xs">
                  {t.autoBackup}
                </Label>
                <Switch
                  id="auto-backup"
                  checked={backupSettings?.enabled ?? false}
                  onCheckedChange={enabled =>
                    backupSettings &&
                    setBackupSettings({ ...backupSettings, enabled })
                  }
                />
              </div>
            </div>

            {backupSettings ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>{t.frequency}</Label>
                  <Select
                    value={String(backupSettings.intervalHours)}
                    onValueChange={value =>
                      setBackupSettings({
                        ...backupSettings,
                        intervalHours: Number(
                          value
                        ) as BackupSettings["intervalHours"],
                      })
                    }
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="6">{t.every6}</SelectItem>
                      <SelectItem value="12">{t.every12}</SelectItem>
                      <SelectItem value="24">{t.daily}</SelectItem>
                      <SelectItem value="168">{t.weekly}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t.retention}</Label>
                  <Input
                    type="number"
                    min="1"
                    max="100"
                    value={backupSettings.retention}
                    onChange={event =>
                      setBackupSettings({
                        ...backupSettings,
                        retention: Number(event.target.value),
                      })
                    }
                    className="mt-2"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label>{t.directory}</Label>
                  <div className="mt-2 flex gap-2">
                    <Input
                      value={backupSettings.directory}
                      readOnly
                      className="min-w-0 flex-1"
                    />
                    <Button
                      variant="outline"
                      onClick={chooseDirectory}
                      className="shrink-0"
                    >
                      <FolderOpen size={15} /> {t.choose}
                    </Button>
                  </div>
                </div>
                <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-600">
                  <span>
                    {t.lastSuccess}:{" "}
                    {backupSettings.lastBackupAt
                      ? new Intl.DateTimeFormat(language, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(backupSettings.lastBackupAt))
                      : t.never}
                  </span>
                  {backupSettings.lastError && (
                    <span className="text-red-300/80">{t.lastFailed}</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="h-28 animate-pulse rounded-md bg-white/[0.03]" />
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={working === "backup"}
                onClick={manualBackup}
                className="border-violet-300/20 bg-violet-400/[0.07] text-violet-100"
              >
                <HardDriveDownload size={15} /> {t.backupNow}
              </Button>
              <Button variant="outline" onClick={openImport}>
                <FileArchive size={15} /> {t.importBackup}
              </Button>
            </div>
          </section>
        </div>

        <div className="flex items-center justify-end border-t border-white/[0.08] px-6 py-4">
          <Button
            disabled={!backupSettings || working === "save"}
            onClick={saveAll}
            className="bg-violet-500 hover:bg-violet-400"
          >
            {working === "save" ? (
              <Spinner className="size-4" />
            ) : (
              <Check size={15} />
            )}
            {t.save}
          </Button>
        </div>
      </section>

      <Dialog
        open={Boolean(totpSetup)}
        onOpenChange={next => !next && setTotpSetup(null)}
      >
        <DialogContent className="max-w-lg border-white/[0.1] bg-[#141419] text-white sm:rounded-lg">
          <DialogHeader>
            <DialogTitle>{t.setupTitle}</DialogTitle>
            <DialogDescription>{t.setupHint}</DialogDescription>
          </DialogHeader>
          {totpSetup && (
            <div className="grid gap-5 sm:grid-cols-[184px_1fr] sm:items-center">
              <img
                src={totpSetup.qrDataUrl}
                alt={t.setupTitle}
                className="mx-auto h-[184px] w-[184px] rounded-md border-8 border-white bg-white"
              />
              <div className="min-w-0 space-y-3">
                <Label>{t.code}</Label>
                <Input
                  autoFocus
                  inputMode="numeric"
                  maxLength={6}
                  value={totpCode}
                  onChange={event =>
                    setTotpCode(event.target.value.replace(/\D/g, ""))
                  }
                  onKeyDown={event =>
                    event.key === "Enter" && confirmQuickSetup()
                  }
                  className="text-center text-base"
                />
                <Button
                  disabled={working === "quick-confirm"}
                  onClick={confirmQuickSetup}
                  className="w-full bg-violet-500 hover:bg-violet-400"
                >
                  <RotateCcw size={15} /> {t.verify}
                </Button>
                <p className="break-all rounded-md bg-black/25 p-2 text-center text-[11px] text-zinc-500">
                  {t.manualSecret}: {totpSetup.manualSecret}
                </p>
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(totpSetup.manualSecret);
                    toast.success(t.copied);
                  }}
                  className="flex w-full items-center justify-center gap-2 text-xs text-zinc-500 hover:text-white"
                >
                  <Copy size={13} /> {t.copySecret}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={next => !next && closeImport()}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto border-white/[0.1] bg-[#141419] text-white sm:rounded-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileArchive size={18} className="text-violet-300" />{" "}
              {t.importTitle}
            </DialogTitle>
            <DialogDescription>{t.importHint}</DialogDescription>
          </DialogHeader>

          {!preview ? (
            <div className="space-y-4 py-2">
              <div>
                <Label>{t.selectedFile}</Label>
                <p
                  className="mt-2 truncate rounded-md bg-black/25 px-3 py-2 text-xs text-zinc-500"
                  title={importPath}
                >
                  {importPath}
                </p>
              </div>
              <div>
                <Label htmlFor="import-backup-password">
                  {t.backupPassword}
                </Label>
                <Input
                  id="import-backup-password"
                  autoFocus
                  type="password"
                  value={backupPassword}
                  onChange={event => setBackupPassword(event.target.value)}
                  onKeyDown={event => event.key === "Enter" && inspectImport()}
                  className="mt-2"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={closeImport}>
                  {t.cancel}
                </Button>
                <Button
                  disabled={working === "inspect"}
                  onClick={inspectImport}
                  className="bg-violet-500 hover:bg-violet-400"
                >
                  <ArchiveRestore size={15} /> {t.readBackup}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-5 py-2">
              <div className="grid grid-cols-3 gap-3 border-y border-white/[0.08] py-4 text-center">
                <div>
                  <strong className="block text-lg">
                    {preview.accountCount}
                  </strong>
                  <span className="text-xs text-zinc-600">{t.accounts}</span>
                </div>
                <div>
                  <strong className="block text-lg">
                    {preview.groupCount}
                  </strong>
                  <span className="text-xs text-zinc-600">{t.groups}</span>
                </div>
                <div>
                  <strong className="block text-xs leading-7">
                    {new Intl.DateTimeFormat(language, {
                      dateStyle: "medium",
                    }).format(new Date(preview.createdAt))}
                  </strong>
                  <span className="text-xs text-zinc-600">{t.createdAt}</span>
                </div>
              </div>

              <div>
                <Label>{t.chooseMode}</Label>
                <div className="mt-2 grid gap-2">
                  {(
                    [
                      ["add", t.addMode, t.addHint],
                      ["replace", t.replaceMode, t.replaceHint],
                      ["backupGroup", t.groupMode, t.groupHint],
                    ] as const
                  ).map(([value, label, hint]) => (
                    <button
                      key={value}
                      onClick={() => setMode(value)}
                      className={`rounded-lg border p-3 text-left ${mode === value ? "border-violet-400 bg-violet-400/[0.07]" : "border-white/[0.08] hover:border-white/20"}`}
                    >
                      <strong className="block text-sm">{label}</strong>
                      <span className="mt-1 block text-xs leading-5 text-zinc-500">
                        {hint}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {mode === "replace" && (
                <div className="space-y-4 border-t border-red-300/15 pt-4">
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="backup-current">{t.backupCurrent}</Label>
                    <Switch
                      id="backup-current"
                      checked={backupCurrent}
                      onCheckedChange={setBackupCurrent}
                    />
                  </div>
                  <div>
                    <Label htmlFor="import-current-password">
                      {t.currentPasswordAgain}
                    </Label>
                    <Input
                      id="import-current-password"
                      type="password"
                      value={currentPassword}
                      onChange={event => setCurrentPassword(event.target.value)}
                      className="mt-2"
                    />
                    <p className="mt-2 text-xs leading-5 text-zinc-500">
                      {t.currentPasswordNote}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={closeImport}>
                  {t.cancel}
                </Button>
                <Button
                  disabled={working === "import"}
                  onClick={commitImport}
                  className="bg-violet-500 hover:bg-violet-400"
                >
                  <Check size={15} /> {t.executeImport}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
