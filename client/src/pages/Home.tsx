/* Visual direction: “加密索引库” — an asymmetric graphite workbench, thin purple index lines, and privacy-first actions. */
import { Button } from "@/components/ui/button";
import AuthScreen from "@/components/AuthScreen";
import UnlockTransition from "@/components/UnlockTransition";
import VaultSettingsDialog from "@/components/VaultSettingsDialog";
import VaultMark from "@/components/VaultMark";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  CirclePlus,
  Clipboard,
  Copy,
  Edit3,
  FolderPlus,
  KeyRound,
  Lock,
  Menu,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  TimerReset,
  Trash2,
  Upload,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generateTotp, getTotpSecondsLeft } from "@/lib/totp";
import type {
  AppLanguage,
  UnlockView,
  VaultAccount,
  VaultGroup,
  VaultPayload,
  VaultStatus,
} from "@/lib/types";
import { vaultApi } from "@/lib/vaultApi";

const QR_TEXTURE = "./assets/github-vault-qr-panel_14bbe081.jpg";
const EMPTY_STATE = "./assets/github-vault-empty-state_546529c7.jpg";

type AccountDraft = Omit<
  VaultAccount,
  "id" | "createdAt" | "updatedAt" | "avatarUrl" | "githubCreatedAt"
>;

const freshDraft = (groupId = ""): AccountDraft => ({
  name: "",
  email: "",
  password: "",
  totpSecret: "",
  groupId,
});

const copy = {
  "zh-CN": {
    app: "Github Auth",
    index: "账户索引",
    localIndex: "本地索引",
    localOnly: "仅本地",
    encryptedIndex: "加密索引",
    identity: "身份资料",
    record: "保管记录",
    lockedState: "已锁定",
    keyDerivation: "密钥衍生",
    encryption: "本机加密",
    deviceOnly: "仅此设备",
    noGroup: "未分组",
    profile: "资料",
    accountAge: "账户年龄",
    noTwoFactor: "未配置双重验证",
    twoFactorReady: "双重验证就绪",
    currentCode: "当前验证码",
    nextCode: "下一组验证码",
    copyCodeTip: "单击卡片复制当前验证码",
    deleteGroup: "删除分组",
    deleteGroupConfirm: "删除该分组后，组内账户将保留为未分组。是否继续？",
    groupDeleted: "分组已删除，账户已保留为未分组。",
    processing: "处理中…",
    storageLoading: "正在读取本地加密保管库…",
    storageFailed: "无法读取本地加密保管库，请重新启动应用。",
    vaultCreated: "加密保管库已创建。",
    missingCredentials: "请输入账户名称和密码。",
    clipboardUnavailable: "浏览器未允许访问剪贴板。",
    groupCreated: "分组已创建。",
    settingsUpdated: "设置已更新。",
    accountSaved: "账户已加密保存。",
    deleteConfirm: "确定要删除此账户吗？",
    settingsHint:
      "所有保管库内容均在本机加密。退出或点击锁定会清除内存中的解密数据。",
    preferences: "偏好设置",
    security: "安全设置",
    footerEncryption: "本机加密",
    footerNoSync: "不同步云端",
    footerNoTransfer: "不传输机密",
    all: "全部账户",
    groups: "分组",
    addGroup: "新建分组",
    group: "分组",
    add: "添加账户",
    search: "搜索名称、邮箱、分组或创建日期…",
    local: "本机加密",
    publicOnly: "仅公开资料联网",
    locked: "锁定",
    settings: "设置",
    noAccounts: "此索引中还没有账户",
    noAccountsHint:
      "添加第一个账户，邮箱、密码和双重验证密钥将只保存在此设备的加密保管库中。",
    addFirst: "添加第一个账户",
    account: "账户",
    accounts: "账户",
    secure: "已加密",
    totp: "双重验证",
    created: "创建于",
    age: "账户年龄",
    unknown: "待查询",
    unlockTitle: "解锁加密账户索引",
    unlockHint: "保管库仅存在于这台设备。主密码不会被保存或传输。",
    masterPassword: "主密码",
    confirmPassword: "确认主密码",
    createVault: "创建加密保管库",
    unlock: "解锁保管库",
    firstTitle: "初始化本地账户索引",
    firstHint:
      "使用至少 12 位主密码生成本机密钥。主密码无法恢复，也不会离开此设备。",
    invalidPassword: "主密码至少应包含 12 位字符。",
    mismatch: "两次输入的主密码不一致。",
    wrongPassword: "无法解锁。请检查主密码。",
    accountTitle: "添加代码托管身份",
    editTitle: "编辑代码托管身份",
    accountHint:
      "只有用户名会被用于查询公开头像和账户创建日期；邮箱、密码和双重验证密钥永不离开本机。",
    username: "代码托管用户名",
    email: "邮箱",
    password: "密码",
    twoFactor: "双重验证密钥",
    importQr: "导入二维码图片",
    importQrHint: "二维码仅在浏览器内解析，不会上传。",
    save: "加密保存",
    cancel: "取消",
    groupName: "分组名称",
    createGroup: "创建分组",
    groupHint: "分组用于将账户拆分显示，例如团队、个人或归档。",
    copyName: "复制用户名",
    copyEmail: "复制邮箱",
    copyPassword: "复制密码",
    copyTotp: "复制双重验证码",
    edit: "编辑资料",
    delete: "删除账户",
    copied: "已复制",
    copiedHint: "剪贴板将按设置在 30 秒后尝试清空。",
    copiedPassword: "密码已复制",
    copiedCode: "双重验证码已复制",
    unableCode: "当前账户没有可用的双重验证密钥。",
    menuHint: "右键账户卡片可打开安全复制菜单。",
    vaultSettings: "保管库设置",
    language: "界面语言",
    clipboard: "复制后自动清空剪贴板",
    seconds: "秒",
    disabled: "关闭",
    changeMaster: "更改主密码",
    oldPassword: "当前主密码",
    newPassword: "新主密码",
    export: "导出加密备份",
    exportHint: "导出的文件仍为本机加密格式，不含可读的账户资料。",
    currentData: "当前数据",
    profileFailed: "未能查询公开头像，账户已安全保存。",
    qrImported: "已从本地二维码导入双重验证密钥。",
    qrFailed: "未从该图片识别到有效二维码。",
    updated: "已加密更新",
    deleted: "账户已从加密索引中移除。",
    masterChanged: "主密码已更改，数据已重新加密。",
    backupDownloaded: "加密备份已下载。",
    noResults: "没有匹配的索引项",
    noResultsHint: "尝试使用账户名、邮箱、分组、公开创建日期或账户年龄搜索。",
  },
  en: {
    app: "Github Auth",
    index: "Account Index",
    localIndex: "Local index",
    localOnly: "Local only",
    encryptedIndex: "Encrypted index",
    identity: "Identity record",
    record: "Vault record",
    lockedState: "Locked",
    keyDerivation: "Key derivation",
    encryption: "Local encryption",
    deviceOnly: "This device only",
    noGroup: "No group",
    profile: "Profile",
    accountAge: "Account age",
    noTwoFactor: "No 2FA",
    twoFactorReady: "2FA ready",
    currentCode: "Current code",
    nextCode: "Next code",
    copyCodeTip: "Click the card to copy the current code",
    deleteGroup: "Delete group",
    deleteGroupConfirm:
      "Accounts in this group will be kept ungrouped. Continue?",
    groupDeleted: "Group deleted. Accounts are now ungrouped.",
    processing: "Processing…",
    storageLoading: "Loading the local encrypted vault…",
    storageFailed:
      "Unable to read the local encrypted vault. Restart the application.",
    vaultCreated: "Encrypted vault created.",
    missingCredentials: "Enter an account name and password.",
    clipboardUnavailable: "Browser clipboard access was not granted.",
    groupCreated: "Group created.",
    settingsUpdated: "Settings updated.",
    accountSaved: "Account encrypted and saved.",
    deleteConfirm: "Delete this account?",
    settingsHint:
      "All vault content is encrypted on this device. Leaving or locking clears decrypted data from memory.",
    preferences: "Preferences",
    security: "Security",
    footerEncryption: "Local encryption",
    footerNoSync: "No cloud sync",
    footerNoTransfer: "No secret transfer",
    all: "All accounts",
    groups: "Groups",
    addGroup: "New group",
    group: "Group",
    add: "Add account",
    search: "Search name, email, group or creation date…",
    local: "Local AES-256 encryption",
    publicOnly: "Only public profile lookups",
    locked: "Lock",
    settings: "Settings",
    noAccounts: "This index has no accounts yet",
    noAccountsHint:
      "Add your first GitHub identity. Email, password, and 2FA remain only in this device’s encrypted vault.",
    addFirst: "Add first account",
    account: "account",
    accounts: "accounts",
    secure: "encrypted",
    totp: "2FA",
    created: "Created",
    age: "Account age",
    unknown: "Pending lookup",
    unlockTitle: "Unlock encrypted account index",
    unlockHint:
      "This vault only lives on this device. Your master password is never stored or transmitted.",
    masterPassword: "Master password",
    confirmPassword: "Confirm master password",
    createVault: "Create encrypted vault",
    unlock: "Unlock vault",
    firstTitle: "Initialize local account index",
    firstHint:
      "Use a master password of at least 12 characters to generate the device key. It cannot be recovered or leave this device.",
    invalidPassword: "Use a master password with at least 12 characters.",
    mismatch: "The master passwords do not match.",
    wrongPassword: "Unable to unlock. Check your master password.",
    accountTitle: "Add GitHub identity",
    editTitle: "Edit GitHub identity",
    accountHint:
      "Only the username can query a public avatar and GitHub creation date. Email, password, and 2FA never leave this device.",
    username: "GitHub username",
    email: "Email",
    password: "Password",
    twoFactor: "2FA Base32 secret",
    importQr: "Import QR image",
    importQrHint: "The image is decoded in your browser and is never uploaded.",
    save: "Encrypt & save",
    cancel: "Cancel",
    groupName: "Group name",
    createGroup: "Create group",
    groupHint:
      "Groups separate account cards, such as team, personal, or archive.",
    copyName: "Copy username",
    copyEmail: "Copy email",
    copyPassword: "Copy password",
    copyTotp: "Copy 2FA code",
    edit: "Edit identity",
    delete: "Delete account",
    copied: "Copied",
    copiedHint: "The clipboard will be cleared after 30 seconds when enabled.",
    copiedPassword: "Password copied",
    copiedCode: "2FA code copied",
    unableCode: "This account has no usable 2FA secret.",
    menuHint: "Right-click any account card for the secure copy menu.",
    vaultSettings: "Vault settings",
    language: "Interface language",
    clipboard: "Clear clipboard after copying",
    seconds: "seconds",
    disabled: "Disabled",
    changeMaster: "Change master password",
    oldPassword: "Current master password",
    newPassword: "New master password",
    export: "Export encrypted backup",
    exportHint:
      "The downloaded file remains AES-GCM encrypted and contains no readable account fields.",
    currentData: "Current data",
    profileFailed: "Public avatar lookup failed; the account was safely saved.",
    qrImported: "2FA secret imported from your local QR image.",
    qrFailed: "No valid QR code was found in that image.",
    updated: "Encrypted update saved",
    deleted: "Account removed from the encrypted index.",
    masterChanged: "Master password changed and data re-encrypted.",
    backupDownloaded: "Encrypted backup downloaded.",
    noResults: "No matching index records",
    noResultsHint:
      "Search by account name, email, group, public creation date, or account age.",
  },
} as const;

function ageFrom(date?: string) {
  if (!date) return "—";
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000)
  );
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}m`;
  return `${Math.floor(days / 365)}y`;
}

function dateStamp(date?: string) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

function formatCode(code: string | null) {
  return code ? code.replace(/(\d{3})(\d{3})/, "$1 $2") : "— — —";
}

function normalizeTotp(raw: string) {
  try {
    if (raw.trim().startsWith("otpauth://"))
      return (
        new URL(raw.trim()).searchParams.get("secret")?.replace(/\s/g, "") ?? ""
      );
  } catch {
    return "";
  }
  return raw.replace(/\s/g, "").toUpperCase();
}

async function queryPublicProfile(username: string) {
  const response = await fetch(
    `https://api.github.com/users/${encodeURIComponent(username.trim())}`,
    {
      headers: { Accept: "application/vnd.github+json" },
    }
  );
  if (!response.ok) throw new Error("profile lookup failed");
  const profile = (await response.json()) as {
    avatar_url?: string;
    created_at?: string;
  };
  return { avatarUrl: profile.avatar_url, githubCreatedAt: profile.created_at };
}

function InitialAvatar({ name, url }: { name: string; url?: string }) {
  if (url) {
    return (
      <img
        className="h-16 w-16 rounded-2xl border border-white/10 object-cover"
        src={url}
        alt=""
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div className="grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-lg font-extrabold text-violet-200">
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function AccountCard({
  account,
  language,
  onContext,
  onCopyCode,
  codes,
  secondsLeft,
}: {
  account: VaultAccount;
  language: AppLanguage;
  onContext: (event: React.MouseEvent, account: VaultAccount) => void;
  onCopyCode: (value: string) => void;
  codes?: { current: string | null; next: string | null };
  secondsLeft: number;
}) {
  const cardCopy = copy[language];
  const age = account.githubCreatedAt ? ageFrom(account.githubCreatedAt) : "—";
  const progress = Math.max(5, (secondsLeft / 30) * 100);
  return (
    <article
      className="vault-card group min-h-[236px] cursor-copy rounded-2xl p-6 hover:border-violet-400/70"
      role="button"
      tabIndex={0}
      onClick={() => onCopyCode(codes?.current ?? "")}
      onKeyDown={event =>
        event.key === "Enter" && onCopyCode(codes?.current ?? "")
      }
      onContextMenu={event => onContext(event, account)}
    >
      <div
        className="absolute left-0 top-0 h-[3px] bg-violet-400"
        style={{ width: `${progress}%` }}
      />
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <InitialAvatar name={account.name} url={account.avatarUrl} />
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h3 className="truncate text-xl font-extrabold tracking-[-0.03em] text-white">
                {account.name}
              </h3>
              <span className="mono shrink-0 text-[11px] text-violet-200">
                {age}
              </span>
            </div>
            <p className="mt-1.5 truncate text-[13px] font-medium text-zinc-500">
              {account.email || "—"}
            </p>
          </div>
        </div>
        <span className="mono rounded-lg border border-white/[0.08] px-2 py-1 text-[10px] text-zinc-500">
          {secondsLeft} {language === "zh-CN" ? "秒" : "s"}
        </span>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-4 border-t border-white/[0.07] pt-5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-zinc-500">
            {cardCopy.currentCode}
          </p>
          <p className="mono mt-2 truncate text-xl font-bold tracking-[0.08em] text-violet-100">
            {formatCode(codes?.current ?? null)}
          </p>
        </div>
        <div className="min-w-0 text-right">
          <p className="text-[11px] font-semibold text-zinc-500">
            {cardCopy.nextCode}
          </p>
          <p className="mono mt-2 truncate text-xl font-bold tracking-[0.08em] text-zinc-500">
            {formatCode(codes?.next ?? null)}
          </p>
        </div>
      </div>
      <div className="mt-5 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-zinc-400">
          <Copy size={12} className="text-violet-300" /> {cardCopy.copyCodeTip}
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600">
          <TimerReset size={12} />{" "}
          {account.totpSecret ? cardCopy.twoFactorReady : cardCopy.noTwoFactor}
        </span>
      </div>
    </article>
  );
}

export default function Home() {
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  const [storageState, setStorageState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [vault, setVault] = useState<VaultPayload | null>(null);
  const [pendingUnlock, setPendingUnlock] = useState<UnlockView | null>(null);
  const [quickUnlockEnabled, setQuickUnlockEnabled] = useState(false);
  const [isAccountDialogOpen, setAccountDialogOpen] = useState(false);
  const [isGroupDialogOpen, setGroupDialogOpen] = useState(false);
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<VaultAccount | null>(null);
  const [draft, setDraft] = useState<AccountDraft>(freshDraft());
  const [groupName, setGroupName] = useState("");
  const [context, setContext] = useState<{
    x: number;
    y: number;
    account: VaultAccount;
  } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [totpCodes, setTotpCodes] = useState<
    Record<string, { current: string | null; next: string | null }>
  >({});
  const fileInput = useRef<HTMLInputElement>(null);

  const lang = vault?.settings.language ?? "zh-CN";
  const t = copy[lang];
  const totpWindow = Math.floor(now / 30_000);

  useEffect(() => {
    let active = true;
    vaultApi
      .getStatus()
      .then(status => {
        if (active) {
          setVaultStatus(status);
          setQuickUnlockEnabled(status.quickUnlockEnabled);
        }
      })
      .then(() => {
        if (active) setStorageState("ready");
      })
      .catch(() => {
        if (active) setStorageState("error");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let active = true;
    if (!vault) {
      setTotpCodes({});
      return () => {
        active = false;
      };
    }
    const accounts = vault.accounts.filter(account => account.totpSecret);
    Promise.all(
      accounts.map(
        async account =>
          [
            account.id,
            {
              current: await generateTotp(account.totpSecret, now),
              next: await generateTotp(account.totpSecret, now + 30_000),
            },
          ] as const
      )
    ).then(entries => {
      if (active) setTotpCodes(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
  }, [vault, totpWindow]);

  useEffect(() => {
    const close = () => setContext(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  async function persist(next: VaultPayload) {
    await vaultApi.savePayload(next);
    setVault(next);
  }

  function acceptUnlock(view: UnlockView) {
    setPendingUnlock(view);
  }

  const completeUnlock = useCallback(() => {
    if (!pendingUnlock) return;
    setVault(pendingUnlock.payload);
    setQuickUnlockEnabled(pendingUnlock.quickUnlockEnabled);
    setVaultStatus({
      hasVault: true,
      quickUnlockEnabled: pendingUnlock.quickUnlockEnabled,
    });
    setPendingUnlock(null);
  }, [pendingUnlock]);

  async function lockVault() {
    await vaultApi.lock().catch(() => undefined);
    setPendingUnlock(null);
    setVault(null);
    setContext(null);
    setSearch("");
    setEditing(null);
    setDraft(freshDraft());
    setTotpCodes({});
    setActiveGroup("all");
    setGroupName("");
    setAccountDialogOpen(false);
    setGroupDialogOpen(false);
    setSettingsOpen(false);
  }

  async function handleCopy(value: string, label: string) {
    if (!value) return toast.error(t.unableCode);
    try {
      await navigator.clipboard.writeText(value);
      toast.success(label, {
        description: vault?.settings.clipboardClearSeconds
          ? t.copiedHint.replace(
              "30",
              String(vault.settings.clipboardClearSeconds)
            )
          : undefined,
      });
      const seconds = vault?.settings.clipboardClearSeconds ?? 0;
      if (seconds > 0)
        window.setTimeout(async () => {
          try {
            // Only wipe the clipboard while it still holds this secret, so a later
            // copy the user made in the meantime survives.
            if ((await navigator.clipboard.readText()) !== value) return;
          } catch {
            // Reading can be denied; clearing is still the safer outcome.
          }
          await navigator.clipboard.writeText("").catch(() => undefined);
        }, seconds * 1_000);
    } catch {
      toast.error(t.clipboardUnavailable);
    }
  }

  function openCreateAccount() {
    setEditing(null);
    setDraft(freshDraft(activeGroup === "all" ? "" : activeGroup));
    setAccountDialogOpen(true);
  }

  function openEditAccount(account: VaultAccount) {
    setEditing(account);
    setDraft({
      name: account.name,
      email: account.email,
      password: account.password,
      totpSecret: account.totpSecret,
      groupId: account.groupId,
    });
    setAccountDialogOpen(true);
  }

  async function saveAccount() {
    if (!vault || !draft.name.trim() || !draft.password)
      return toast.error(t.missingCredentials);
    const timestamp = new Date().toISOString();
    let publicProfile: Pick<VaultAccount, "avatarUrl" | "githubCreatedAt"> =
      editing
        ? {
            avatarUrl: editing.avatarUrl,
            githubCreatedAt: editing.githubCreatedAt,
          }
        : {};
    try {
      publicProfile = await queryPublicProfile(draft.name);
    } catch {
      toast.info(t.profileFailed);
    }
    const account: VaultAccount = {
      ...draft,
      totpSecret: normalizeTotp(draft.totpSecret),
      ...publicProfile,
      id: editing?.id ?? crypto.randomUUID(),
      createdAt: editing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    const accounts = editing
      ? vault.accounts.map(item => (item.id === editing.id ? account : item))
      : [account, ...vault.accounts];
    await persist({ ...vault, accounts });
    setAccountDialogOpen(false);
    setEditing(null);
    toast.success(editing ? t.updated : t.accountSaved);
  }

  async function createGroup() {
    if (!vault || !groupName.trim()) return;
    const group: VaultGroup = {
      id: crypto.randomUUID(),
      name: groupName.trim(),
      color: "#A855F7",
      createdAt: new Date().toISOString(),
    };
    await persist({ ...vault, groups: [...vault.groups, group] });
    setActiveGroup(group.id);
    setGroupName("");
    setGroupDialogOpen(false);
    toast.success(t.groupCreated);
  }

  async function removeGroup(group: VaultGroup) {
    if (!vault || !window.confirm(t.deleteGroupConfirm)) return;
    const accounts = vault.accounts.map(account =>
      account.groupId === group.id ? { ...account, groupId: "" } : account
    );
    await persist({
      ...vault,
      groups: vault.groups.filter(item => item.id !== group.id),
      accounts,
    });
    setActiveGroup("all");
    toast.success(t.groupDeleted);
  }

  async function removeAccount(account: VaultAccount) {
    if (!vault || !window.confirm(`${t.deleteConfirm} ${account.name}`)) return;
    await persist({
      ...vault,
      accounts: vault.accounts.filter(item => item.id !== account.id),
    });
    toast.success(t.deleted);
  }

  async function importQr(file: File) {
    const { default: jsQR } = await import("jsqr");
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(image, 0, 0);
      const result = jsQR(
        ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        canvas.width,
        canvas.height,
        { inversionAttempts: "attemptBoth" }
      );
      URL.revokeObjectURL(objectUrl);
      if (!result) return toast.error(t.qrFailed);
      const secret = normalizeTotp(result.data);
      if (!secret) return toast.error(t.qrFailed);
      setDraft(current => ({ ...current, totpSecret: secret }));
      toast.success(t.qrImported);
    };
    image.onerror = () => toast.error(t.qrFailed);
    image.src = objectUrl;
  }

  const filteredAccounts = useMemo(() => {
    if (!vault) return [];
    const query = search.trim().toLowerCase();
    return vault.accounts.filter(account => {
      const inGroup = activeGroup === "all" || account.groupId === activeGroup;
      const group =
        vault.groups.find(item => item.id === account.groupId)?.name ?? "";
      const haystack = [
        account.name,
        account.email,
        group,
        dateStamp(account.githubCreatedAt),
        ageFrom(account.githubCreatedAt),
      ]
        .join(" ")
        .toLowerCase();
      return inGroup && (!query || haystack.includes(query));
    });
  }, [activeGroup, search, vault]);

  if (storageState !== "ready") {
    return (
      <main className="screen-fill grid place-items-center bg-[#08080a] px-6 text-white">
        <p className="text-center text-sm text-zinc-400">
          {storageState === "error" ? t.storageFailed : t.storageLoading}
        </p>
      </main>
    );
  }

  if (pendingUnlock) {
    return <UnlockTransition onComplete={completeUnlock} />;
  }

  if (!vault) {
    return <AuthScreen status={vaultStatus!} onUnlocked={acceptUnlock} />;
  }

  const secondsLeft = getTotpSecondsLeft(now);

  return (
    <main className="screen-fill bg-[#08080a] text-white selection:bg-violet-500/40">
      <div className="screen-fill flex">
        <aside className="hidden w-[250px] shrink-0 flex-col border-r border-white/[0.08] bg-[#0b0b0e] p-5 lg:flex">
          <div className="flex items-center gap-3 px-1">
            <VaultMark />
            <p className="text-sm font-bold tracking-tight">{t.app}</p>
          </div>
          <nav className="mt-12 space-y-1">
            <button
              onClick={() => setActiveGroup("all")}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm transition ${activeGroup === "all" ? "bg-violet-500/12 text-white" : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"}`}
            >
              <span className="flex items-center gap-3">
                <UsersRound size={16} /> {t.all}
              </span>
              <span className="mono text-[10px]">{vault.accounts.length}</span>
            </button>
          </nav>
          <div className="mt-9">
            <div className="mb-3 flex items-center justify-between px-3">
              <span className="mono text-[10px] font-medium uppercase tracking-[0.17em] text-zinc-600">
                {t.groups}
              </span>
              <button
                onClick={() => setGroupDialogOpen(true)}
                aria-label={t.addGroup}
                className="text-zinc-500 transition hover:text-violet-300"
              >
                <Plus size={15} />
              </button>
            </div>
            <div className="space-y-1">
              {vault.groups.map(group => (
                <div
                  key={group.id}
                  className={`flex items-center rounded-xl pr-2 ${activeGroup === group.id ? "bg-white/[0.07] text-white" : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200"}`}
                >
                  <button
                    onClick={() => setActiveGroup(group.id)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left text-sm"
                  >
                    <i className="h-2 w-2 shrink-0 rounded-full bg-violet-400" />
                    <span className="truncate">{group.name}</span>
                    <span className="mono ml-auto text-[10px]">
                      {
                        vault.accounts.filter(
                          account => account.groupId === group.id
                        ).length
                      }
                    </span>
                  </button>
                  <button
                    onClick={() => removeGroup(group)}
                    aria-label={`${t.deleteGroup} ${group.name}`}
                    className="grid h-7 w-7 place-items-center rounded-lg text-zinc-600 hover:bg-red-400/10 hover:text-red-300"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-auto flex items-center gap-2 border-t border-white/[0.08] pt-5">
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label={t.settings}
              className="grid h-10 w-10 place-items-center rounded-xl text-zinc-400 hover:bg-white/[0.06] hover:text-white"
            >
              <Settings2 size={18} />
            </button>
            <button
              onClick={lockVault}
              aria-label={t.locked}
              className="grid h-10 w-10 place-items-center rounded-xl border border-white/[0.08] text-zinc-400 hover:border-violet-300/30 hover:text-violet-200"
            >
              <Lock size={17} />
            </button>
          </div>
        </aside>
        <section className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex h-[76px] items-center gap-3 border-b border-white/[0.08] bg-[#08080a]/88 px-4 backdrop-blur-xl sm:px-7">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-zinc-400 hover:bg-white/[0.06] lg:hidden"
                  aria-label="菜单"
                >
                  <Menu size={20} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-[70vh] w-64 border-white/[0.1] bg-[#141419] p-2 text-zinc-200 lg:hidden"
              >
                <DropdownMenuLabel className="text-[10px] uppercase text-zinc-600">
                  {t.groups}
                </DropdownMenuLabel>
                <DropdownMenuItem
                  onSelect={() => setActiveGroup("all")}
                  className={activeGroup === "all" ? "bg-violet-500/15" : ""}
                >
                  <UsersRound />
                  <span className="min-w-0 flex-1 truncate">{t.all}</span>
                  <span className="mono text-[10px] text-zinc-600">
                    {vault.accounts.length}
                  </span>
                </DropdownMenuItem>
                {vault.groups.map(group => (
                  <DropdownMenuItem
                    key={group.id}
                    onSelect={() => setActiveGroup(group.id)}
                    className={
                      activeGroup === group.id ? "bg-violet-500/15" : ""
                    }
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: group.color }}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {group.name}
                    </span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem onSelect={() => setGroupDialogOpen(true)}>
                  <FolderPlus /> {t.addGroup}
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-white/[0.08]" />
                <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                  <Settings2 /> {t.settings}
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={lockVault}>
                  <Lock /> {t.locked}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <h1 className="hidden shrink-0 text-lg font-extrabold tracking-[-0.03em] sm:block">
              {t.index}
            </h1>
            <div className="relative min-w-0 flex-1 max-w-xl">
              <Search
                size={17}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-600"
              />
              <Input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder={t.search}
                className="h-11 rounded-xl border-white/[0.08] bg-white/[0.035] pl-10 text-sm placeholder:text-zinc-600 focus-visible:ring-violet-400/50"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                >
                  <X size={15} />
                </button>
              )}
            </div>
            <Button
              onClick={openCreateAccount}
              className="h-11 shrink-0 rounded-xl bg-violet-500 px-4 font-bold hover:bg-violet-400"
            >
              <Plus size={17} className="mr-2" />
              {t.add}
            </Button>
            <div className="hidden max-w-sm items-center gap-2 border-l border-white/[0.08] pl-4 2xl:flex">
              <ShieldCheck size={16} className="shrink-0 text-violet-300" />
              <p className="text-[11px] leading-4 text-zinc-500">
                邮箱、密码、双重验证密钥与配置均保存在当前设备的加密容器中。
              </p>
            </div>
          </header>
          <div className="p-4 sm:p-7">
            {filteredAccounts.length ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3 3xl:grid-cols-4">
                {filteredAccounts.map(account => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    language={lang}
                    codes={totpCodes[account.id]}
                    secondsLeft={secondsLeft}
                    onCopyCode={value => handleCopy(value, t.copiedCode)}
                    onContext={(event, item) => {
                      event.preventDefault();
                      setContext({
                        x: event.clientX,
                        y: event.clientY,
                        account: item,
                      });
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="relative isolate flex min-h-[480px] overflow-hidden rounded-3xl border border-dashed border-white/[0.11] bg-white/[0.02] p-7">
                <div
                  className="absolute inset-0 bg-cover bg-center opacity-20"
                  style={{ backgroundImage: `url(${EMPTY_STATE})` }}
                />
                <div className="relative my-auto max-w-md">
                  <h2 className="text-2xl font-extrabold tracking-[-0.04em]">
                    {search ? t.noResults : t.noAccounts}
                  </h2>
                  <p className="mt-3 max-w-sm text-sm leading-6 text-zinc-500">
                    {search ? t.noResultsHint : t.noAccountsHint}
                  </p>
                  {!search && (
                    <Button
                      onClick={openCreateAccount}
                      className="mt-6 bg-violet-500 font-bold hover:bg-violet-400"
                    >
                      <CirclePlus className="mr-2" size={17} />
                      {t.addFirst}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {context && (
        <div
          onClick={event => event.stopPropagation()}
          className="fixed z-50 w-60 overflow-hidden rounded-2xl border border-white/[0.12] bg-[#1a1a20]/95 p-1.5 shadow-2xl backdrop-blur-xl"
          style={{
            left: Math.min(context.x, window.innerWidth - 260),
            top: Math.min(context.y, window.innerHeight - 310),
          }}
        >
          <div className="mono border-b border-white/[0.08] px-3 py-2.5 text-[10px] uppercase tracking-[0.13em] text-zinc-600">
            {context.account.name}
          </div>
          <MenuItem
            icon={<UserRound size={15} />}
            label={t.copyName}
            onClick={() => handleCopy(context.account.name, t.copied)}
          />
          <MenuItem
            icon={<Clipboard size={15} />}
            label={t.copyEmail}
            onClick={() => handleCopy(context.account.email, t.copied)}
          />
          <MenuItem
            icon={<KeyRound size={15} />}
            label={t.copyPassword}
            onClick={() =>
              handleCopy(context.account.password, t.copiedPassword)
            }
          />
          <MenuItem
            icon={<TimerReset size={15} />}
            label={`${t.copyTotp} · ${secondsLeft}s`}
            onClick={async () => {
              const code = await generateTotp(context.account.totpSecret, now);
              handleCopy(code ?? "", t.copiedCode);
            }}
          />
          <div className="my-1 border-t border-white/[0.08]" />
          <MenuItem
            icon={<Edit3 size={15} />}
            label={t.edit}
            onClick={() => {
              openEditAccount(context.account);
              setContext(null);
            }}
          />
          <MenuItem
            danger
            icon={<Trash2 size={15} />}
            label={t.delete}
            onClick={() => {
              removeAccount(context.account);
              setContext(null);
            }}
          />
        </div>
      )}

      <Dialog open={isAccountDialogOpen} onOpenChange={setAccountDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto border-white/[0.1] bg-[#141419] p-0 text-white sm:rounded-2xl">
          <div className="relative overflow-hidden border-b border-white/[0.08] p-6">
            <div
              className="absolute inset-0 bg-cover bg-center opacity-20"
              style={{ backgroundImage: `url(${QR_TEXTURE})` }}
            />
            <div className="relative">
              <DialogHeader>
                <DialogTitle className="text-xl font-extrabold tracking-[-0.03em]">
                  {editing ? t.editTitle : t.accountTitle}
                </DialogTitle>
                <DialogDescription className="mt-2 max-w-lg text-sm leading-6 text-zinc-400">
                  {t.accountHint}
                </DialogDescription>
              </DialogHeader>
            </div>
          </div>
          <div className="space-y-5 p-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={t.username}>
                <Input
                  value={draft.name}
                  onChange={event =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                  placeholder="octocat"
                  autoFocus
                />
              </Field>
              <Field label={t.group}>
                <Select
                  value={draft.groupId || "__none__"}
                  onValueChange={groupId =>
                    setDraft({
                      ...draft,
                      groupId: groupId === "__none__" ? "" : groupId,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t.noGroup}</SelectItem>
                    {vault.groups.map(group => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label={t.email}>
              <Input
                value={draft.email}
                onChange={event =>
                  setDraft({ ...draft, email: event.target.value })
                }
                type="email"
                placeholder="name@example.com"
              />
            </Field>
            <Field label={t.password}>
              <Input
                value={draft.password}
                onChange={event =>
                  setDraft({ ...draft, password: event.target.value })
                }
                type="password"
                placeholder="••••••••••••"
              />
            </Field>
            <div className="rounded-xl border border-white/[0.08] bg-black/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <Label>{t.twoFactor}</Label>
                  <p className="mt-1 text-[11px] leading-5 text-zinc-500">
                    {t.importQrHint}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInput.current?.click()}
                  className="h-9 border-white/[0.1] bg-white/[0.04] text-xs text-zinc-200 hover:bg-white/[0.08]"
                >
                  <Upload size={14} className="mr-2" />
                  {t.importQr}
                </Button>
                <input
                  ref={fileInput}
                  onChange={event =>
                    event.target.files?.[0] && importQr(event.target.files[0])
                  }
                  accept="image/*"
                  type="file"
                  className="hidden"
                />
              </div>
              <Textarea
                value={draft.totpSecret}
                onChange={event =>
                  setDraft({ ...draft, totpSecret: event.target.value })
                }
                className="mono mt-4 min-h-[80px] border-white/[0.08] bg-white/[0.04] text-xs"
                placeholder="JBSWY3DPEHPK3PXP"
              />
            </div>
            <div className="flex justify-end gap-3 pt-1">
              <Button
                variant="ghost"
                onClick={() => setAccountDialogOpen(false)}
                className="text-zinc-400 hover:bg-white/[0.06] hover:text-white"
              >
                {t.cancel}
              </Button>
              <Button
                onClick={saveAccount}
                className="bg-violet-500 font-bold hover:bg-violet-400"
              >
                <Lock size={15} className="mr-2" />
                {t.save}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isGroupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="max-w-md border-white/[0.1] bg-[#141419] text-white">
          <DialogHeader>
            <DialogTitle>{t.createGroup}</DialogTitle>
            <DialogDescription>{t.groupHint}</DialogDescription>
          </DialogHeader>
          <Field label={t.groupName}>
            <Input
              autoFocus
              value={groupName}
              onChange={event => setGroupName(event.target.value)}
              onKeyDown={event => event.key === "Enter" && createGroup()}
              placeholder="团队账户"
            />
          </Field>
          <div className="flex justify-end gap-3">
            <Button
              variant="ghost"
              onClick={() => setGroupDialogOpen(false)}
              className="text-zinc-400"
            >
              {t.cancel}
            </Button>
            <Button
              onClick={createGroup}
              className="bg-violet-500 hover:bg-violet-400"
            >
              <FolderPlus size={15} className="mr-2" />
              {t.createGroup}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <VaultSettingsDialog
        open={isSettingsOpen}
        onOpenChange={setSettingsOpen}
        language={lang}
        settings={vault.settings}
        quickUnlockEnabled={quickUnlockEnabled}
        onSavePreferences={async settings => {
          await persist({ ...vault, settings });
        }}
        onQuickUnlockChange={enabled => {
          setQuickUnlockEnabled(enabled);
          setVaultStatus(status =>
            status ? { ...status, quickUnlockEnabled: enabled } : status
          );
        }}
        onImported={payload => setVault(payload)}
      />
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm text-zinc-300">{label}</Label>
      {children}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-semibold transition ${danger ? "text-red-300 hover:bg-red-400/10" : "text-zinc-300 hover:bg-white/[0.07] hover:text-white"}`}
    >
      {icon}
      {label}
    </button>
  );
}
