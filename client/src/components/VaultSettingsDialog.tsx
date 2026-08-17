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
import { vaultApi } from "@/lib/vaultApi";
import {
  ArchiveRestore,
  Check,
  Copy,
  FileArchive,
  FolderOpen,
  HardDriveDownload,
  KeyRound,
  Languages,
  LoaderCircle,
  QrCode,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const text = {
  "zh-CN": {
    title: "保管库设置",
    hint: "安全设置和备份操作均在本机完成。",
    preferences: "偏好设置",
    language: "界面语言",
    clipboard: "复制后清空剪贴板",
    seconds: "秒",
    disabled: "关闭",
    security: "安全设置",
    currentPassword: "当前主密码",
    newPassword: "新主密码",
    confirmPassword: "确认新主密码",
    changePassword: "更改主密码",
    mismatch: "两次输入的新主密码不一致。",
    invalidPassword: "新主密码至少应包含 12 位字符。",
    passwordChanged: "主密码已更改。旧备份仍需要旧密码。",
    wrongPassword: "当前主密码错误或操作失败。",
    quickUnlock: "2FA 快速登录",
    quickEnabled: "已绑定当前 Windows 用户",
    quickDisabled: "未启用",
    bind: "绑定",
    rebind: "重新绑定",
    disableQuick: "停用",
    quickPasswordHint: "输入当前主密码以更改 2FA",
    quickEnabledToast: "2FA 快速登录已启用。",
    quickDisabledToast: "2FA 快速登录已停用。",
    backup: "加密备份",
    autoBackup: "自动备份",
    runtimeOnly: "仅软件运行期间执行，锁定状态也可备份。",
    frequency: "频率",
    every6: "每 6 小时",
    every12: "每 12 小时",
    daily: "每天一次",
    weekly: "每周一次",
    directory: "保存位置",
    choose: "选择",
    retention: "保留最近份数",
    lastSuccess: "上次成功",
    never: "尚未执行",
    lastFailed: "上次自动备份失败，请检查保存目录。",
    backupNow: "立即备份",
    importBackup: "导入备份",
    backupDone: "加密备份已保存。",
    backupFailed: "无法完成备份，请检查目录权限。",
    save: "保存设置",
    saved: "设置已保存。",
    operationFailed: "操作失败，请重试。",
    setupTitle: "绑定 Google Authenticator",
    setupHint: "扫描二维码并输入当前 6 位验证码。",
    code: "动态验证码",
    verify: "验证并启用",
    manualSecret: "手动设置密钥",
    copySecret: "复制设置密钥",
    copied: "设置密钥已复制。",
    importTitle: "导入加密备份",
    importHint: "先使用备份生成时的主密码读取文件。",
    selectedFile: "已选择文件",
    backupPassword: "备份生成时的主密码",
    readBackup: "验证并读取",
    backupPasswordError: "备份密码错误或文件已损坏。",
    summary: "备份摘要",
    accounts: "账户",
    groups: "分组",
    createdAt: "生成时间",
    chooseMode: "选择导入方式",
    addMode: "添加到当前数据",
    addHint: "保留当前数据，导入账户和原分组。",
    replaceMode: "替换当前数据",
    replaceHint: "替换账户、分组和偏好，保留当前密码与 2FA。",
    groupMode: "加入备份分类",
    groupHint: "所有导入账户放入一个“备份导入”分组。",
    backupCurrent: "替换前备份当前数据",
    currentPasswordAgain: "当前客户端主密码",
    currentPasswordNote: "备份密码只读取文件；当前主密码用于授权替换。",
    executeImport: "执行导入",
    importDone: "备份已安全导入。",
    importFailed: "导入失败，当前数据未被修改。",
    cancel: "取消",
  },
  en: {
    title: "Vault settings",
    hint: "Security settings and backups remain on this device.",
    preferences: "Preferences",
    language: "Interface language",
    clipboard: "Clear clipboard after copying",
    seconds: "seconds",
    disabled: "Disabled",
    security: "Security",
    currentPassword: "Current master password",
    newPassword: "New master password",
    confirmPassword: "Confirm new password",
    changePassword: "Change password",
    mismatch: "The new passwords do not match.",
    invalidPassword: "Use a new master password with at least 12 characters.",
    passwordChanged:
      "Master password changed. Older backups still use the old password.",
    wrongPassword: "The current password is incorrect or the operation failed.",
    quickUnlock: "2FA quick unlock",
    quickEnabled: "Bound to the current Windows user",
    quickDisabled: "Not enabled",
    bind: "Enable",
    rebind: "Rebind",
    disableQuick: "Disable",
    quickPasswordHint: "Enter the current password to change 2FA",
    quickEnabledToast: "2FA quick unlock enabled.",
    quickDisabledToast: "2FA quick unlock disabled.",
    backup: "Encrypted backups",
    autoBackup: "Automatic backup",
    runtimeOnly: "Runs only while the app is open, including while locked.",
    frequency: "Frequency",
    every6: "Every 6 hours",
    every12: "Every 12 hours",
    daily: "Daily",
    weekly: "Weekly",
    directory: "Destination",
    choose: "Choose",
    retention: "Recent backups to keep",
    lastSuccess: "Last success",
    never: "Not run yet",
    lastFailed: "The last automatic backup failed. Check the destination.",
    backupNow: "Back up now",
    importBackup: "Import backup",
    backupDone: "Encrypted backup saved.",
    backupFailed: "Unable to create the backup. Check folder permissions.",
    save: "Save settings",
    saved: "Settings saved.",
    operationFailed: "The operation failed. Try again.",
    setupTitle: "Bind Google Authenticator",
    setupHint: "Scan the QR code and enter the current 6-digit code.",
    code: "Authenticator code",
    verify: "Verify and enable",
    manualSecret: "Manual setup key",
    copySecret: "Copy setup key",
    copied: "Setup key copied.",
    importTitle: "Import encrypted backup",
    importHint:
      "First enter the master password used when the backup was created.",
    selectedFile: "Selected file",
    backupPassword: "Backup's original master password",
    readBackup: "Verify and read",
    backupPasswordError:
      "The backup password is incorrect or the file is damaged.",
    summary: "Backup summary",
    accounts: "accounts",
    groups: "groups",
    createdAt: "Created",
    chooseMode: "Choose import mode",
    addMode: "Add to current data",
    addHint: "Keep current data and import accounts with their groups.",
    replaceMode: "Replace current data",
    replaceHint:
      "Replace data and preferences while retaining the current password and 2FA.",
    groupMode: "Add as backup group",
    groupHint: "Put all imported accounts in one backup import group.",
    backupCurrent: "Back up current data before replacing",
    currentPasswordAgain: "Current vault master password",
    currentPasswordNote:
      "The backup password reads the file; the current password authorizes replacement.",
    executeImport: "Import",
    importDone: "Backup imported safely.",
    importFailed: "Import failed. Current data was not changed.",
    cancel: "Cancel",
  },
} as const;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  language: AppLanguage;
  settings: VaultSettings;
  quickUnlockEnabled: boolean;
  onSavePreferences: (settings: VaultSettings) => Promise<void>;
  onQuickUnlockChange: (enabled: boolean) => void;
  onImported: (payload: VaultPayload) => void;
};

export default function VaultSettingsDialog({
  open,
  onOpenChange,
  language,
  settings,
  quickUnlockEnabled,
  onSavePreferences,
  onQuickUnlockChange,
  onImported,
}: Props) {
  const t = text[language];
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
    if (!open) return;
    setPreferences(settings);
    vaultApi
      .getBackupSettings()
      .then(setBackupSettings)
      .catch(() => toast.error(t.operationFailed));
  }, [open, settings, t.operationFailed]);

  async function saveAll() {
    if (!backupSettings) return;
    setWorking("save");
    try {
      await onSavePreferences(preferences);
      setBackupSettings(await vaultApi.updateBackupSettings(backupSettings));
      toast.success(t.saved);
      onOpenChange(false);
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
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto border-white/[0.1] bg-[#141419] p-0 text-white sm:rounded-lg">
          <DialogHeader className="border-b border-white/[0.08] px-6 py-5">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Settings2 size={18} className="text-violet-300" /> {t.title}
            </DialogTitle>
            <DialogDescription>{t.hint}</DialogDescription>
          </DialogHeader>

          <div className="px-6">
            <section className="py-5">
              <p className="mb-4 flex items-center gap-2 text-xs font-bold text-zinc-500">
                <Languages size={15} /> {t.preferences}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>{t.language}</Label>
                  <Select
                    value={preferences.language}
                    onValueChange={(value: AppLanguage) =>
                      setPreferences({ ...preferences, language: value })
                    }
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="zh-CN">简体中文</SelectItem>
                      <SelectItem value="en">English</SelectItem>
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
                      {preferences.clipboardClearSeconds
                        ? t.seconds
                        : t.disabled}
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <section className="border-t border-white/[0.08] py-5">
              <p className="mb-4 flex items-center gap-2 text-xs font-bold text-zinc-500">
                <ShieldCheck size={15} /> {t.security}
              </p>
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
                    <QrCode size={15} />{" "}
                    {quickUnlockEnabled ? t.rebind : t.bind}
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

          <div className="flex justify-end border-t border-white/[0.08] px-6 py-4">
            <Button
              disabled={!backupSettings || working === "save"}
              onClick={saveAll}
              className="bg-violet-500 hover:bg-violet-400"
            >
              {working === "save" ? (
                <LoaderCircle className="animate-spin" size={15} />
              ) : (
                <Check size={15} />
              )}
              {t.save}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
