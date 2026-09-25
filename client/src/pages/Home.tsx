/* Visual direction: “加密索引库” — an asymmetric graphite workbench, thin purple index lines, and privacy-first actions. */
import { Button } from "@/components/ui/button";
import AuthScreen from "@/components/AuthScreen";
import UnlockTransition from "@/components/UnlockTransition";
import VaultSettingsPage from "@/components/VaultSettingsPage";
import LocalApiPage from "@/components/LocalApiPage";
import LocalApiImportDialog from "@/components/LocalApiImportDialog";
import LocalApiExportDialog from "@/components/LocalApiExportDialog";
import LocalApiPairingDialog from "@/components/LocalApiPairingDialog";
import ScreenCaptureRiskDialog from "@/components/ScreenCaptureRiskDialog";
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
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import {
  CirclePlus,
  Clipboard,
  Copy,
  Edit3,
  Folder,
  FolderPlus,
  KeyRound,
  Lock,
  Menu,
  Network,
  PanelLeft,
  PanelLeftClose,
  Plus,
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
import {
  registerClearGroupFilter,
  registerCreateAccount,
  setShellGroupHint,
  setShellSearch,
  setShellSearchPlaceholder,
  setShellUnlocked,
  sidebarShell,
  useShellSearch,
  useSidebarCollapsed,
} from "@/lib/shellStore";
import type {
  UnlockView,
  PendingApiImport,
  PendingApiExport,
  PendingPairing,
  VaultAccount,
  VaultEmail,
  VaultGroup,
  VaultPayload,
  VaultStatus,
} from "@/lib/types";
import type { Dictionary } from "@/lib/i18n";
import { useLanguage } from "@/contexts/LanguageContext";
import { vaultApi } from "@/lib/vaultApi";
import { listen } from "@tauri-apps/api/event";

const QR_TEXTURE = "./assets/github-vault-qr-panel_14bbe081.jpg";
const EMPTY_STATE = "./assets/github-vault-empty-state_546529c7.jpg";

type AccountDraft = Omit<
  VaultAccount,
  "id" | "createdAt" | "updatedAt" | "avatarUrl" | "githubCreatedAt"
>;

const normalizeEmails = (
  account: Pick<VaultAccount, "email" | "emails">
): VaultEmail[] => {
  const emails = Array.isArray(account.emails)
    ? account.emails.filter(item => item?.value?.trim())
    : [];
  if (emails.length) {
    const primaryIndex = Math.max(
      0,
      emails.findIndex(item => item.isPrimary)
    );
    return emails.map((item, index) => ({
      value: item.value.trim(),
      isPrimary: index === primaryIndex,
      showOnHome: index === primaryIndex ? true : Boolean(item.showOnHome),
    }));
  }
  return account.email.trim()
    ? [{ value: account.email.trim(), isPrimary: true, showOnHome: true }]
    : [];
};

const freshDraft = (groupId = ""): AccountDraft => ({
  name: "",
  email: "",
  emails: [{ value: "", isPrimary: true, showOnHome: true }],
  password: "",
  totpSecret: "",
  groupId,
  note: "",
});

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

function dateStamp(date: string | undefined, locale: string) {
  if (!date) return "—";
  return new Intl.DateTimeFormat(locale, {
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
  t,
  onContext,
  onCopyCode,
  codes,
  secondsLeft,
}: {
  account: VaultAccount;
  t: Dictionary["home"];
  onContext: (event: React.MouseEvent, account: VaultAccount) => void;
  onCopyCode: (value: string) => void;
  codes?: { current: string | null; next: string | null };
  secondsLeft: number;
}) {
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
      <div className="flex min-w-0 items-center gap-3">
        <InitialAvatar name={account.name} url={account.avatarUrl} />
        <div className="min-w-0">
          <div className="flex items-baseline gap-2 pr-14">
            <h3 className="break-all text-xl font-extrabold tracking-[-0.03em] text-white">
              {account.name}
            </h3>
            <span className="mono shrink-0 text-[11px] text-violet-200">
              {age}
            </span>
          </div>
          <div className="mt-1.5 flex min-w-0 flex-col gap-0.5 text-[13px] font-medium text-zinc-500">
            {normalizeEmails(account)
              .filter(item => item.showOnHome)
              .slice(0, 2)
              .map(item => (
                <p key={item.value} className="break-all">
                  {item.value}
                </p>
              ))}
          </div>
        </div>
      </div>
      {/* Out of the flex flow so the countdown never squeezes the email block
          into wrapping — the two never compete for width. */}
      <span className="mono absolute right-5 top-5 whitespace-nowrap rounded-lg border border-white/[0.08] px-2 py-1 text-[10px] text-zinc-500">
        {secondsLeft} {t.secondsShort}
      </span>
      <div className="mt-8 grid grid-cols-2 gap-4 border-t border-white/[0.07] pt-5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-zinc-500">
            {t.currentCode}
          </p>
          <p className="mono mt-2 truncate text-xl font-bold tracking-[0.08em] text-violet-100">
            {formatCode(codes?.current ?? null)}
          </p>
        </div>
        <div className="min-w-0 text-right">
          <p className="text-[11px] font-semibold text-zinc-500">
            {t.nextCode}
          </p>
          <p className="mono mt-2 truncate text-xl font-bold tracking-[0.08em] text-zinc-500">
            {formatCode(codes?.next ?? null)}
          </p>
        </div>
      </div>
      <div className="mt-5 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-zinc-400">
          <Copy size={12} className="text-violet-300" /> {t.copyCodeTip}
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600">
          <TimerReset size={12} />{" "}
          {account.totpSecret ? t.twoFactorReady : t.noTwoFactor}
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
  const [isLocalApiOpen, setLocalApiOpen] = useState(false);
  const [pendingApiImports, setPendingApiImports] = useState<
    PendingApiImport[]
  >([]);
  const [pendingApiExports, setPendingApiExports] = useState<
    PendingApiExport[]
  >([]);
  const [pendingApiPairings, setPendingApiPairings] = useState<
    PendingPairing[]
  >([]);
  const [activeGroup, setActiveGroup] = useState("all");
  const search = useShellSearch();
  const sidebarCollapsed = useSidebarCollapsed();
  const [editing, setEditing] = useState<VaultAccount | null>(null);
  const [draft, setDraft] = useState<AccountDraft>(freshDraft());
  const [groupName, setGroupName] = useState("");
  const [editingGroup, setEditingGroup] = useState<VaultGroup | null>(null);
  const [groupContext, setGroupContext] = useState<{
    x: number;
    y: number;
    group: VaultGroup;
  } | null>(null);
  const [groupDeleteTarget, setGroupDeleteTarget] = useState<VaultGroup | null>(
    null
  );
  const [deleteGroupWithAccounts, setDeleteGroupWithAccounts] = useState(false);
  const [deleteVerifySecret, setDeleteVerifySecret] = useState("");
  const [previewAccount, setPreviewAccount] = useState<VaultAccount | null>(
    null
  );
  const [groupsFlyoutOpen, setGroupsFlyoutOpen] = useState(false);
  const groupsFlyoutCloseTimer = useRef<number | null>(null);

  // Hover-open flyout: closing is deferred briefly so crossing the gap between
  // the rail icon and the portaled menu never snaps it shut mid-move.
  function scheduleGroupsFlyoutClose() {
    if (groupsFlyoutCloseTimer.current !== null)
      window.clearTimeout(groupsFlyoutCloseTimer.current);
    groupsFlyoutCloseTimer.current = window.setTimeout(() => {
      groupsFlyoutCloseTimer.current = null;
      setGroupsFlyoutOpen(false);
    }, 180);
  }

  function cancelGroupsFlyoutClose() {
    if (groupsFlyoutCloseTimer.current !== null) {
      window.clearTimeout(groupsFlyoutCloseTimer.current);
      groupsFlyoutCloseTimer.current = null;
    }
  }

  useEffect(
    () => () => {
      if (groupsFlyoutCloseTimer.current !== null)
        window.clearTimeout(groupsFlyoutCloseTimer.current);
    },
    []
  );
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

  const { language, t } = useLanguage();
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
    const close = () => {
      setContext(null);
      setGroupContext(null);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  // The top toolbar renders the vault search and create action, so it needs to know
  // whether the vault screen is active and which dialog opener to call.
  useEffect(() => {
    setShellSearchPlaceholder(t.home.search);
  }, [t.home.search]);

  useEffect(() => {
    setShellUnlocked(Boolean(vault));
    if (!vault) setShellSearch("");
  }, [vault]);

  useEffect(() => {
    if (!vault) {
      setPendingApiPairings([]);
      setPendingApiImports([]);
      setPendingApiExports([]);
      return;
    }
    let disposed = false;
    let refreshVersion = 0;
    const unlisteners: Array<() => void> = [];
    const refreshPending = () => {
      const version = ++refreshVersion;
      vaultApi
        .getPendingApiPairings()
        .then(requests => {
          if (!disposed && version === refreshVersion) setPendingApiPairings(requests);
        })
        .catch(() => undefined);
      vaultApi
        .getPendingApiImports()
        .then(requests => {
          if (!disposed && version === refreshVersion) setPendingApiImports(requests);
        })
        .catch(() => undefined);
      vaultApi
        .getPendingApiExports()
        .then(requests => {
          if (!disposed && version === refreshVersion) setPendingApiExports(requests);
        })
        .catch(() => undefined);
    };
    window.addEventListener("focus", refreshPending);
    const refreshTimer = window.setInterval(refreshPending, 5_000);
    const subscriptions = [listen<PendingPairing>("local-api-pairing-request", event => {
      if (disposed) return;
      refreshVersion++;
      setPendingApiPairings(current =>
        current.some(request => request.id === event.payload.id)
          ? current
          : [...current, event.payload]
      );
    }).then(unlisten => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    }),
    listen<PendingApiImport>("local-api-import-request", event => {
      if (disposed) return;
      refreshVersion++;
      setPendingApiImports(current =>
        current.some(request => request.id === event.payload.id)
          ? current
          : [...current, event.payload]
      );
    }).then(unlisten => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    }),
    listen<PendingApiExport>("local-api-export-request", event => {
      if (disposed) return;
      refreshVersion++;
      setPendingApiExports(current =>
        current.some(request => request.id === event.payload.id)
          ? current
          : [...current, event.payload]
      );
    }).then(unlisten => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    }),
    listen("local-api-state-changed", () => {
      vaultApi
        .getUnlockedPayload()
        .then(payload => !disposed && setVault(payload))
        .catch(() => undefined);
      refreshPending();
    }).then(unlisten => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    })];
    // Subscribe before reading the snapshot so a request cannot arrive between
    // the initial read and event registration.
    void Promise.allSettled(subscriptions).then(() => {
      if (!disposed) refreshPending();
    });
    return () => {
      disposed = true;
      window.removeEventListener("focus", refreshPending);
      window.clearInterval(refreshTimer);
      unlisteners.forEach(unlisten => unlisten());
    };
  }, [Boolean(vault)]);

  // The toolbar chip shows which group the index is filtered by.
  useEffect(() => {
    if (!vault || activeGroup === "all") {
      setShellGroupHint(null);
      return;
    }
    const group = vault.groups.find(item => item.id === activeGroup);
    setShellGroupHint(
      group ? { id: group.id, name: group.name, color: group.color } : null
    );
  }, [vault, activeGroup]);

  useEffect(() => {
    registerClearGroupFilter(() => selectGroup("all"));
    return () => registerClearGroupFilter(null);
  }, []);

  useEffect(() => {
    if (!vault) return;
    // Re-registered every render so the opener always sees the active group.
    registerCreateAccount(openCreateAccount);
    return () => registerCreateAccount(null);
  });

  // Picking a group is navigation: it always leaves the settings page.
  function selectGroup(groupId: string) {
    setActiveGroup(groupId);
    setSettingsOpen(false);
    setLocalApiOpen(false);
  }

  async function persist(next: VaultPayload) {
    await vaultApi.savePayload(next);
    setVault(next);
  }

  function acceptUnlock(view: UnlockView) {
    setPendingUnlock(view);
  }

  const completeUnlock = useCallback(() => {
    if (!pendingUnlock) return;
    const payload = pendingUnlock.payload;
    // The vault carries the active UI language so stored settings stay
    // coherent; the UI itself always follows the LanguageProvider.
    setVault(
      payload.settings.language === language
        ? payload
        : { ...payload, settings: { ...payload.settings, language } }
    );
    setQuickUnlockEnabled(pendingUnlock.quickUnlockEnabled);
    setVaultStatus({
      hasVault: true,
      quickUnlockEnabled: pendingUnlock.quickUnlockEnabled,
    });
    setPendingUnlock(null);
  }, [pendingUnlock, language]);

  async function lockVault() {
    await vaultApi.lock().catch(() => undefined);
    setPendingUnlock(null);
    setVault(null);
    setContext(null);
    setShellSearch("");
    setEditing(null);
    setDraft(freshDraft());
    setTotpCodes({});
    setActiveGroup("all");
    setGroupName("");
    setAccountDialogOpen(false);
    setGroupDialogOpen(false);
    setSettingsOpen(false);
    setLocalApiOpen(false);
    setPendingApiPairings([]);
    setPendingApiImports([]);
    setPendingApiExports([]);
  }

  async function handleCopy(value: string, label: string) {
    if (!value) return toast.error(t.home.unableCode);
    try {
      await navigator.clipboard.writeText(value);
      toast.success(label, {
        description: vault?.settings.clipboardClearSeconds
          ? t.home.copiedHint.replace(
              "{seconds}",
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
      toast.error(t.home.clipboardUnavailable);
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
      emails: normalizeEmails(account),
      password: account.password,
      totpSecret: account.totpSecret,
      groupId: account.groupId,
      note: account.note ?? "",
    });
    setAccountDialogOpen(true);
  }

  function openEditGroup(group: VaultGroup) {
    setEditingGroup(group);
    setGroupName(group.name);
    setGroupDialogOpen(true);
    setGroupContext(null);
  }

  async function saveAccount() {
    if (!vault || !draft.name.trim() || !draft.password)
      return toast.error(t.home.missingCredentials);
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
      toast.info(t.home.profileFailed);
    }
    const emails = (draft.emails ?? [])
      .filter(item => item.value.trim())
      .map(item => ({ ...item, value: item.value.trim() }));
    const primaryIndex = Math.max(
      0,
      emails.findIndex(item => item.isPrimary)
    );
    const normalizedEmails = emails.map((item, index) => ({
      ...item,
      isPrimary: emails.length > 0 && index === primaryIndex,
      showOnHome:
        emails.length > 0 &&
        (index === primaryIndex || Boolean(item.showOnHome)),
    }));
    if (normalizedEmails.filter(item => item.showOnHome).length > 2) {
      return toast.error(t.home.maxHomeEmails);
    }
    const account: VaultAccount = {
      ...draft,
      email: normalizedEmails[primaryIndex]?.value ?? "",
      emails: normalizedEmails,
      note: draft.note.trim(),
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
    toast.success(editing ? t.home.updated : t.home.accountSaved);
  }

  async function createGroup() {
    if (!vault || !groupName.trim()) return;
    const group: VaultGroup = editingGroup
      ? { ...editingGroup, name: groupName.trim() }
      : {
          id: crypto.randomUUID(),
          name: groupName.trim(),
          color: "#A855F7",
          createdAt: new Date().toISOString(),
        };
    await persist({
      ...vault,
      groups: editingGroup
        ? vault.groups.map(item => (item.id === group.id ? group : item))
        : [...vault.groups, group],
    });
    setActiveGroup(group.id);
    setGroupName("");
    setEditingGroup(null);
    setGroupDialogOpen(false);
    toast.success(editingGroup ? t.home.groupUpdated : t.home.groupCreated);
  }

  async function removeGroup(group: VaultGroup, withAccounts = false) {
    if (!vault) return;
    if (withAccounts) {
      // Destructive confirmation: quick unlock (2FA) when configured, otherwise
      // the current master password plays the same role.
      const secret = deleteVerifySecret.trim();
      if (!secret)
        return toast.error(
          quickUnlockEnabled
            ? t.home.totpRequired
            : t.home.masterPasswordRequired
        );
      try {
        if (quickUnlockEnabled) await vaultApi.verifyTotpForAction(secret);
        else await vaultApi.verifyPasswordForAction(secret);
      } catch (error) {
        return toast.error(String(error));
      }
    }
    const accounts = withAccounts
      ? vault.accounts.filter(account => account.groupId !== group.id)
      : vault.accounts.map(account =>
          account.groupId === group.id ? { ...account, groupId: "" } : account
        );
    await persist({
      ...vault,
      groups: vault.groups.filter(item => item.id !== group.id),
      accounts,
    });
    setActiveGroup("all");
    setGroupDeleteTarget(null);
    setDeleteVerifySecret("");
    setDeleteGroupWithAccounts(false);
    toast.success(
      withAccounts ? t.home.groupDeletedWithAccounts : t.home.groupDeleted
    );
  }

  async function removeAccount(account: VaultAccount) {
    if (!vault || !window.confirm(`${t.home.deleteConfirm} ${account.name}`))
      return;
    await persist({
      ...vault,
      accounts: vault.accounts.filter(item => item.id !== account.id),
    });
    toast.success(t.home.deleted);
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
      if (!result) return toast.error(t.home.qrFailed);
      const secret = normalizeTotp(result.data);
      if (!secret) return toast.error(t.home.qrFailed);
      setDraft(current => ({ ...current, totpSecret: secret }));
      toast.success(t.home.qrImported);
    };
    image.onerror = () => toast.error(t.home.qrFailed);
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
        ...normalizeEmails(account).map(item => item.value),
        account.note,
        group,
        dateStamp(account.githubCreatedAt, language),
        ageFrom(account.githubCreatedAt),
      ]
        .join(" ")
        .toLowerCase();
      return inGroup && (!query || haystack.includes(query));
    });
  }, [activeGroup, search, vault, language]);

  if (storageState !== "ready") {
    return (
      <main className="screen-fill grid place-items-center bg-[#08080a] px-6 text-white">
        <div className="flex flex-col items-center gap-4">
          {storageState === "loading" && (
            <div className="grid size-12 place-items-center rounded-full border border-violet-300/15 bg-violet-400/[0.06] shadow-[0_0_32px_rgba(168,85,247,0.12)]">
              <Spinner className="size-6 text-violet-200" />
            </div>
          )}
          <p className="text-center text-sm text-zinc-400">
            {storageState === "error"
              ? t.home.storageFailed
              : t.home.storageLoading}
          </p>
        </div>
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
    <main className="flex h-full min-h-0 flex-col bg-[#08080a] text-white selection:bg-violet-500/40">
      <div className="flex min-h-0 flex-1">
        <aside
          className="no-scrollbar hidden shrink-0 flex-col overflow-x-hidden overflow-y-auto border-r border-white/[0.08] bg-[#0b0b0e] px-3 py-4 transition-[width] duration-300 ease-out lg:flex"
          style={{
            width: sidebarCollapsed
              ? "var(--shell-sidebar-collapsed)"
              : "var(--shell-sidebar)",
          }}
        >
          <div
            className={`px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.17em] text-zinc-600 ${sidebarCollapsed ? "hidden" : "block"}`}
          >
            {t.home.index}
          </div>
          <nav className="space-y-1">
            <button
              onClick={() => selectGroup("all")}
              title={sidebarCollapsed ? t.home.all : undefined}
              className={`relative flex h-[38px] items-center rounded-[9px] text-sm transition-colors ${
                sidebarCollapsed
                  ? "w-[38px] justify-center self-center"
                  : "w-full gap-3 px-3"
              } ${
                activeGroup === "all"
                  ? "bg-white/[0.07] font-semibold text-white"
                  : "font-medium text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
              }`}
            >
              {activeGroup === "all" && (
                <span
                  className={`absolute bottom-[9px] top-[9px] w-[2px] rounded-full bg-violet-400 ${sidebarCollapsed ? "left-1" : "left-0"}`}
                />
              )}
              <span
                className={`grid h-[22px] w-[22px] shrink-0 place-items-center ${activeGroup === "all" ? "text-zinc-200" : "text-zinc-500"}`}
              >
                <UsersRound size={16} />
              </span>
              {!sidebarCollapsed && (
                <>
                  <span className="flex-1 truncate text-left">
                    {t.home.all}
                  </span>
                  <span className="mono text-[10px] text-zinc-500">
                    {vault.accounts.length}
                  </span>
                </>
              )}
            </button>
          </nav>
          {sidebarCollapsed ? (
            /* Collapsed rail: the group dots fold into one icon whose flyout
               (to the right) carries the full group switcher. */
            <div className="mt-4 flex justify-center">
              {/* modal={false}: modal menus set `pointer-events: none` on <body>,
                  which makes Chromium fire synthetic mouseleave/mouseenter on the
                  icon — the flyout opened, closed and reopened (double pop).
                  Hover menus should be non-modal anyway. */}
              <DropdownMenu
                modal={false}
                open={groupsFlyoutOpen}
                onOpenChange={setGroupsFlyoutOpen}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    onMouseEnter={() => {
                      cancelGroupsFlyoutClose();
                      setGroupsFlyoutOpen(true);
                    }}
                    onMouseLeave={scheduleGroupsFlyoutClose}
                    title={t.home.groups}
                    aria-label={t.home.groups}
                    className={`relative grid h-[38px] w-[38px] place-items-center rounded-[9px] transition-colors ${
                      activeGroup !== "all"
                        ? "bg-white/[0.07] text-white"
                        : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
                    }`}
                  >
                    {activeGroup !== "all" && (
                      <span className="absolute bottom-[9px] left-1 top-[9px] w-[2px] rounded-full bg-violet-400" />
                    )}
                    <Folder size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="right"
                  align="start"
                  onMouseEnter={cancelGroupsFlyoutClose}
                  onMouseLeave={scheduleGroupsFlyoutClose}
                  className="max-h-[70vh] w-56 border-white/[0.1] bg-[#141419] p-2 text-zinc-200"
                >
                  {vault.groups.map(group => (
                    <DropdownMenuItem
                      key={group.id}
                      onSelect={() => selectGroup(group.id)}
                      onContextMenu={event => {
                        event.preventDefault();
                        setGroupContext({
                          x: event.clientX,
                          y: event.clientY,
                          group,
                        });
                      }}
                      className={
                        activeGroup === group.id ? "bg-violet-500/15" : ""
                      }
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: group.color }}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {group.name}
                      </span>
                      <span className="mono text-[10px] text-zinc-600">
                        {
                          vault.accounts.filter(
                            account => account.groupId === group.id
                          ).length
                        }
                      </span>
                    </DropdownMenuItem>
                  ))}
                  {vault.groups.length > 0 && (
                    <DropdownMenuSeparator className="bg-white/[0.08]" />
                  )}
                  <DropdownMenuItem
                    onSelect={() => {
                      setEditingGroup(null);
                      setGroupName("");
                      setGroupDialogOpen(true);
                    }}
                  >
                    <FolderPlus /> {t.home.addGroup}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : (
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between px-2">
                <span className="mono text-[10px] font-medium uppercase tracking-[0.17em] text-zinc-600">
                  {t.home.groups}
                </span>
                <button
                  onClick={() => {
                    setEditingGroup(null);
                    setGroupName("");
                    setGroupDialogOpen(true);
                  }}
                  aria-label={t.home.addGroup}
                  className="text-zinc-500 transition hover:text-violet-300"
                >
                  <Plus size={15} />
                </button>
              </div>
              <div className="space-y-1">
                {vault.groups.map(group => {
                  const active = activeGroup === group.id;
                  const count = vault.accounts.filter(
                    account => account.groupId === group.id
                  ).length;
                  return (
                    <div
                      key={group.id}
                      onContextMenu={event => {
                        event.preventDefault();
                        setGroupContext({
                          x: event.clientX,
                          y: event.clientY,
                          group,
                        });
                      }}
                      className={`relative flex h-[38px] items-center rounded-[9px] transition-colors ${
                        sidebarCollapsed
                          ? "w-[38px] justify-center self-center"
                          : "w-full pr-2"
                      } ${
                        active
                          ? "bg-white/[0.07] text-white"
                          : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
                      }`}
                    >
                      {active && (
                        <span
                          className={`absolute bottom-[9px] top-[9px] w-[2px] rounded-full bg-violet-400 ${sidebarCollapsed ? "left-1" : "left-0"}`}
                        />
                      )}
                      <button
                        onClick={() => selectGroup(group.id)}
                        title={sidebarCollapsed ? group.name : undefined}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left text-sm font-medium"
                      >
                        <span className="grid h-[22px] w-[22px] shrink-0 place-items-center">
                          <i
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: group.color }}
                          />
                        </span>
                        {!sidebarCollapsed && (
                          <>
                            <span className="flex-1 truncate">
                              {group.name}
                            </span>
                            <span className="mono text-[10px] text-zinc-500">
                              {count}
                            </span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="mt-auto shrink-0">
            <div
              className={`pt-3 ${
                sidebarCollapsed
                  ? "flex flex-col items-center gap-1"
                  : "space-y-1"
              }`}
            >
              <button
                onClick={() => {
                  setLocalApiOpen(true);
                  setSettingsOpen(false);
                }}
                aria-label={
                  language.startsWith("zh") ? "本机接口" : "Local API"
                }
                title={language.startsWith("zh") ? "本机接口" : "Local API"}
                className={`flex h-[38px] items-center rounded-[9px] text-sm font-medium text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-200 ${
                  sidebarCollapsed
                    ? "w-[38px] justify-center"
                    : "w-full gap-3 px-3"
                }`}
              >
                <Network size={16} />
                {!sidebarCollapsed && (
                  <span>
                    {language.startsWith("zh") ? "本机接口" : "Local API"}
                  </span>
                )}
              </button>
              <button
                onClick={() => {
                  setSettingsOpen(true);
                  setLocalApiOpen(false);
                }}
                aria-label={t.home.settings}
                title={t.home.settings}
                className={`flex h-[38px] items-center rounded-[9px] text-sm font-medium text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-200 ${
                  sidebarCollapsed
                    ? "w-[38px] justify-center"
                    : "w-full gap-3 px-3"
                }`}
              >
                <Settings2 size={16} />
                {!sidebarCollapsed && <span>{t.home.settings}</span>}
              </button>
              <button
                onClick={lockVault}
                aria-label={t.home.locked}
                title={t.home.locked}
                className={`flex h-[38px] items-center rounded-[9px] text-sm font-medium text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-violet-200 ${
                  sidebarCollapsed
                    ? "w-[38px] justify-center"
                    : "w-full gap-3 px-3"
                }`}
              >
                <Lock size={16} />
                {!sidebarCollapsed && <span>{t.home.locked}</span>}
              </button>
              <button
                onClick={() => sidebarShell.setCollapsed(!sidebarCollapsed)}
                aria-label={
                  sidebarCollapsed
                    ? t.home.expandSidebar
                    : t.home.collapseSidebar
                }
                title={
                  sidebarCollapsed
                    ? t.home.expandSidebar
                    : t.home.collapseSidebar
                }
                className={`flex h-[38px] items-center rounded-[9px] text-sm font-medium text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-200 ${
                  sidebarCollapsed
                    ? "w-[38px] justify-center"
                    : "w-full gap-3 px-3"
                }`}
              >
                {sidebarCollapsed ? (
                  <PanelLeft size={16} />
                ) : (
                  <PanelLeftClose size={16} />
                )}
                {!sidebarCollapsed && <span>{t.home.collapseSidebar}</span>}
              </button>
            </div>
            <div className="mt-3 border-t border-white/[0.08]" />
          </div>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          {isSettingsOpen ? (
            <VaultSettingsPage
              onBack={() => setSettingsOpen(false)}
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
          ) : isLocalApiOpen ? (
            <LocalApiPage
              onBack={() => setLocalApiOpen(false)}
              vault={vault}
              quickUnlockEnabled={quickUnlockEnabled}
              onVaultChange={setVault}
            />
          ) : (
            <>
              {/* No bottom border here: the toolbar hairline above this row is the
              separator, and its left end meets the sidebar's right edge. */}
              <header className="flex h-[54px] shrink-0 items-center gap-3 px-4 sm:px-7">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-zinc-400 hover:bg-white/[0.06] lg:hidden"
                      aria-label={t.home.menu}
                    >
                      <Menu size={20} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="max-h-[70vh] w-64 border-white/[0.1] bg-[#141419] p-2 text-zinc-200 lg:hidden"
                  >
                    <DropdownMenuLabel className="text-[10px] uppercase text-zinc-600">
                      {t.home.groups}
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      onSelect={() => selectGroup("all")}
                      className={
                        activeGroup === "all" ? "bg-violet-500/15" : ""
                      }
                    >
                      <UsersRound />
                      <span className="min-w-0 flex-1 truncate">
                        {t.home.all}
                      </span>
                      <span className="mono text-[10px] text-zinc-600">
                        {vault.accounts.length}
                      </span>
                    </DropdownMenuItem>
                    {vault.groups.map(group => (
                      <DropdownMenuItem
                        key={group.id}
                        onSelect={() => selectGroup(group.id)}
                        onContextMenu={event => {
                          event.preventDefault();
                          setGroupContext({
                            x: event.clientX,
                            y: event.clientY,
                            group,
                          });
                        }}
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
                    <DropdownMenuItem
                      onSelect={() => {
                        setEditingGroup(null);
                        setGroupName("");
                        setGroupDialogOpen(true);
                      }}
                    >
                      <FolderPlus /> {t.home.addGroup}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-white/[0.08]" />
                    <DropdownMenuItem
                      onSelect={() => {
                        setLocalApiOpen(true);
                        setSettingsOpen(false);
                      }}
                    >
                      <Network />
                      {language.startsWith("zh") ? "本机接口" : "Local API"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        setSettingsOpen(true);
                        setLocalApiOpen(false);
                      }}
                    >
                      <Settings2 /> {t.home.settings}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={lockVault}
                    >
                      <Lock /> {t.home.locked}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <h1 className="shrink-0 text-lg font-extrabold tracking-[-0.03em]">
                  {t.home.index}
                </h1>
                <div className="ml-auto hidden max-w-sm items-center gap-2 border-l border-white/[0.08] pl-4 2xl:flex">
                  <ShieldCheck size={16} className="shrink-0 text-violet-300" />
                  <p className="text-[11px] leading-4 text-zinc-500">
                    {t.home.headerPrivacy}
                  </p>
                </div>
              </header>
              <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-7">
                {filteredAccounts.length ? (
                  /* Auto-fill keeps every card the same width and reflows by
                 available width: 4 across on a fullscreen 1080p window, fewer
                 as the window shrinks — no fixed breakpoints. */
                  <div className="grid gap-4 [grid-auto-rows:1fr] [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]">
                    {filteredAccounts.map(account => (
                      <AccountCard
                        key={account.id}
                        account={account}
                        t={t.home}
                        codes={totpCodes[account.id]}
                        secondsLeft={secondsLeft}
                        onCopyCode={value =>
                          handleCopy(value, t.home.copiedCode)
                        }
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
                        {search ? t.home.noResults : t.home.noAccounts}
                      </h2>
                      <p className="mt-3 max-w-sm text-sm leading-6 text-zinc-500">
                        {search ? t.home.noResultsHint : t.home.noAccountsHint}
                      </p>
                      {!search && (
                        <Button
                          onClick={openCreateAccount}
                          className="mt-6 bg-violet-500 font-bold hover:bg-violet-400"
                        >
                          <CirclePlus className="mr-2" size={17} />
                          {t.home.addFirst}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <footer
        role="status"
        className="flex h-8 shrink-0 items-center gap-3 border-t border-white/[0.08] px-4 text-[11px] text-zinc-500"
      >
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck size={12} className="text-violet-300" />
          {t.home.footerEncryption}
        </span>
        <span className="h-3.5 w-px bg-white/[0.08]" />
        <span>
          {vault.accounts.length} {t.home.accounts}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          {t.home.footerNoSync}
        </span>
      </footer>

      <LocalApiPairingDialog
        request={pendingApiPairings[0] ?? null}
        quickUnlockEnabled={quickUnlockEnabled}
        onApproved={payload => {
          const resolvedId = pendingApiPairings[0]?.id;
          setVault(payload);
          if (resolvedId) {
            setPendingApiPairings(current =>
              current.filter(request => request.id !== resolvedId)
            );
          }
        }}
        onDenied={() => {
          const resolvedId = pendingApiPairings[0]?.id;
          if (resolvedId) {
            setPendingApiPairings(current =>
              current.filter(request => request.id !== resolvedId)
            );
          }
        }}
      />

      <LocalApiImportDialog
        request={
          pendingApiPairings.length === 0
            ? (pendingApiImports[0] ?? null)
            : null
        }
        groups={vault.groups}
        quickUnlockEnabled={quickUnlockEnabled}
        onResolved={payload => {
          const resolvedId = pendingApiImports[0]?.id;
          setVault(payload);
          if (resolvedId) {
            setPendingApiImports(current =>
              current.filter(request => request.id !== resolvedId)
            );
          }
        }}
      />

      <LocalApiExportDialog
        request={
          pendingApiPairings.length === 0 && pendingApiImports.length === 0
            ? (pendingApiExports[0] ?? null)
            : null
        }
        quickUnlockEnabled={quickUnlockEnabled}
        onResolved={payload => {
          const resolvedId = pendingApiExports[0]?.id;
          setVault(payload);
          if (resolvedId) {
            setPendingApiExports(current =>
              current.filter(request => request.id !== resolvedId)
            );
          }
        }}
      />

      <ScreenCaptureRiskDialog
        onOpenSettings={() => {
          setSettingsOpen(true);
          setLocalApiOpen(false);
        }}
      />

      {context && (
        <div
          onClick={event => event.stopPropagation()}
          className="fixed z-[70] w-60 overflow-hidden rounded-2xl border border-white/[0.12] bg-[#1a1a20]/95 p-1.5 shadow-2xl backdrop-blur-xl"
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
            label={t.home.copyName}
            onClick={() => handleCopy(context.account.name, t.home.copied)}
          />
          <MenuItem
            icon={<Clipboard size={15} />}
            label={t.home.copyEmail}
            onClick={() =>
              handleCopy(
                normalizeEmails(context.account)[0]?.value ??
                  context.account.email,
                t.home.copied
              )
            }
          />
          {normalizeEmails(context.account)
            .slice(1)
            .map(email => (
              <MenuItem
                key={email.value}
                icon={<Clipboard size={15} />}
                label={`${t.home.copyEmail}: ${email.value}`}
                onClick={() => handleCopy(email.value, t.home.copied)}
              />
            ))}
          <MenuItem
            icon={<KeyRound size={15} />}
            label={t.home.copyPassword}
            onClick={() =>
              handleCopy(context.account.password, t.home.copiedPassword)
            }
          />
          <MenuItem
            icon={<TimerReset size={15} />}
            label={`${t.home.copyTotp} · ${secondsLeft}s`}
            onClick={async () => {
              const code = await generateTotp(context.account.totpSecret, now);
              handleCopy(code ?? "", t.home.copiedCode);
            }}
          />
          <MenuItem
            icon={<UserRound size={15} />}
            label={t.home.preview}
            onClick={() => {
              setPreviewAccount(context.account);
              setContext(null);
            }}
          />
          <div className="my-1 border-t border-white/[0.08]" />
          <MenuItem
            icon={<Edit3 size={15} />}
            label={t.home.edit}
            onClick={() => {
              openEditAccount(context.account);
              setContext(null);
            }}
          />
          <MenuItem
            danger
            icon={<Trash2 size={15} />}
            label={t.home.delete}
            onClick={() => {
              removeAccount(context.account);
              setContext(null);
            }}
          />
        </div>
      )}

      {groupContext && (
        <div
          onClick={event => event.stopPropagation()}
          className="fixed z-[70] w-52 overflow-hidden rounded-2xl border border-white/[0.12] bg-[#1a1a20]/95 p-1.5 shadow-2xl backdrop-blur-xl"
          style={{
            left: Math.min(groupContext.x, window.innerWidth - 230),
            top: Math.min(groupContext.y, window.innerHeight - 180),
          }}
        >
          <div className="mono border-b border-white/[0.08] px-3 py-2.5 text-[10px] uppercase tracking-[0.13em] text-zinc-600">
            {groupContext.group.name}
          </div>
          <MenuItem
            icon={<Edit3 size={15} />}
            label={t.home.editGroup}
            onClick={() => openEditGroup(groupContext.group)}
          />
          <MenuItem
            icon={<Trash2 size={15} />}
            danger
            label={t.home.deleteGroup}
            onClick={() => {
              setDeleteGroupWithAccounts(false);
              setDeleteVerifySecret("");
              setGroupDeleteTarget(groupContext.group);
              setGroupContext(null);
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
                  {editing ? t.home.editTitle : t.home.accountTitle}
                </DialogTitle>
                <DialogDescription className="mt-2 max-w-lg text-sm leading-6 text-zinc-400">
                  {t.home.accountHint}
                </DialogDescription>
              </DialogHeader>
            </div>
          </div>
          <div className="space-y-5 p-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={t.home.username}>
                <Input
                  value={draft.name}
                  onChange={event =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                  placeholder="octocat"
                  autoFocus
                />
              </Field>
              <Field label={t.home.group}>
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
                    <SelectItem value="__none__">{t.home.noGroup}</SelectItem>
                    {vault.groups.map(group => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label={t.home.emails}>
              <div className="space-y-2">
                {(draft.emails ?? []).map((email, index) => (
                  <div
                    key={`${index}-${email.value}`}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <Input
                      value={email.value}
                      onChange={event =>
                        setDraft({
                          ...draft,
                          emails: draft.emails.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, value: event.target.value }
                              : item
                          ),
                          email: index === 0 ? event.target.value : draft.email,
                        })
                      }
                      type="email"
                      placeholder="name@example.com"
                      className="min-w-[180px] flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className={`h-9 px-2 text-xs ${email.isPrimary ? "border-violet-400/50 text-violet-200" : "text-zinc-400"}`}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          email: email.value,
                          emails: draft.emails.map((item, itemIndex) => ({
                            ...item,
                            isPrimary: itemIndex === index,
                            showOnHome:
                              itemIndex === index ? true : item.showOnHome,
                          })),
                        })
                      }
                    >
                      {email.isPrimary ? t.home.primary : t.home.primary}
                    </Button>
                    <label className="flex items-center gap-1 text-[11px] text-zinc-500">
                      <input
                        type="checkbox"
                        checked={email.showOnHome}
                        onChange={event =>
                          setDraft({
                            ...draft,
                            emails: draft.emails.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, showOnHome: event.target.checked }
                                : item
                            ),
                          })
                        }
                      />
                      {t.home.showOnHome}
                    </label>
                    {draft.emails.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-9 px-2 text-red-300"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            emails: draft.emails.filter(
                              (_, itemIndex) => itemIndex !== index
                            ),
                          })
                        }
                      >
                        <X size={14} />
                      </Button>
                    )}
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        emails: [
                          ...draft.emails,
                          { value: "", isPrimary: false, showOnHome: false },
                        ],
                      })
                    }
                  >
                    <Plus size={14} className="mr-1" />
                    {t.home.addEmail}
                  </Button>
                  <span className="text-[11px] text-zinc-600">
                    {t.home.maxHomeEmails}
                  </span>
                </div>
              </div>
            </Field>
            <Field label={t.home.password}>
              <Input
                value={draft.password}
                onChange={event =>
                  setDraft({ ...draft, password: event.target.value })
                }
                type="password"
                placeholder="••••••••••••"
              />
            </Field>
            <Field label={t.home.note}>
              <Textarea
                value={draft.note}
                onChange={event =>
                  setDraft({ ...draft, note: event.target.value })
                }
                placeholder={t.home.note}
                className="min-h-[72px] border-white/[0.08] bg-white/[0.04]"
              />
            </Field>
            <div className="rounded-xl border border-white/[0.08] bg-black/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <Label>{t.home.twoFactor}</Label>
                  <p className="mt-1 text-[11px] leading-5 text-zinc-500">
                    {t.home.importQrHint}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInput.current?.click()}
                  className="h-9 border-white/[0.1] bg-white/[0.04] text-xs text-zinc-200 hover:bg-white/[0.08]"
                >
                  <Upload size={14} className="mr-2" />
                  {t.home.importQr}
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
                {t.home.cancel}
              </Button>
              <Button
                onClick={saveAccount}
                className="bg-violet-500 font-bold hover:bg-violet-400"
              >
                <Lock size={15} className="mr-2" />
                {t.home.save}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isGroupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="max-w-md border-white/[0.1] bg-[#141419] text-white">
          <DialogHeader>
            <DialogTitle>
              {editingGroup ? t.home.editGroup : t.home.createGroup}
            </DialogTitle>
            <DialogDescription>{t.home.groupHint}</DialogDescription>
          </DialogHeader>
          <Field label={t.home.groupName}>
            <Input
              autoFocus
              value={groupName}
              onChange={event => setGroupName(event.target.value)}
              onKeyDown={event => event.key === "Enter" && createGroup()}
              placeholder={t.home.groupPlaceholder}
            />
          </Field>
          <div className="flex justify-end gap-3">
            <Button
              variant="ghost"
              onClick={() => setGroupDialogOpen(false)}
              className="text-zinc-400"
            >
              {t.home.cancel}
            </Button>
            <Button
              onClick={createGroup}
              className="bg-violet-500 hover:bg-violet-400"
            >
              <FolderPlus size={15} className="mr-2" />
              {editingGroup ? t.home.editGroup : t.home.createGroup}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(groupDeleteTarget)}
        onOpenChange={open => !open && setGroupDeleteTarget(null)}
      >
        <DialogContent className="max-w-md border-white/[0.1] bg-[#141419] text-white">
          <DialogHeader>
            <DialogTitle>
              {t.home.deleteGroup}: {groupDeleteTarget?.name}
            </DialogTitle>
            <DialogDescription>
              {t.home.groupAccountCount}{" "}
              {groupDeleteTarget
                ? vault.accounts.filter(
                    account => account.groupId === groupDeleteTarget.id
                  ).length
                : 0}{" "}
              {t.home.accounts}。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setDeleteGroupWithAccounts(false)}
              className={`w-full rounded-xl border p-3 text-left ${!deleteGroupWithAccounts ? "border-violet-400/60 bg-violet-500/10" : "border-white/[0.08]"}`}
            >
              <strong className="block text-sm">
                {t.home.deleteGroupOnly}
              </strong>
              <span className="mt-1 block text-xs text-zinc-500">
                {t.home.deleteGroupOnlyHint}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setDeleteGroupWithAccounts(true)}
              className={`w-full rounded-xl border p-3 text-left ${deleteGroupWithAccounts ? "border-red-400/60 bg-red-500/10" : "border-white/[0.08]"}`}
            >
              <strong className="block text-sm text-red-200">
                {t.home.deleteGroupWithAccounts}
              </strong>
              <span className="mt-1 block text-xs text-zinc-500">
                {quickUnlockEnabled
                  ? t.home.deleteGroupWithAccountsHint
                  : t.home.deleteGroupWithAccountsPasswordHint}
              </span>
            </button>
            {deleteGroupWithAccounts &&
              (quickUnlockEnabled ? (
                <Input
                  value={deleteVerifySecret}
                  onChange={event => setDeleteVerifySecret(event.target.value)}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  className="mono text-center tracking-[0.3em]"
                />
              ) : (
                <Input
                  value={deleteVerifySecret}
                  onChange={event => setDeleteVerifySecret(event.target.value)}
                  type="password"
                  placeholder={t.home.oldPassword}
                  className="text-center"
                />
              ))}
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="ghost"
              onClick={() => setGroupDeleteTarget(null)}
              className="text-zinc-400"
            >
              {t.home.cancel}
            </Button>
            <Button
              onClick={() =>
                groupDeleteTarget &&
                removeGroup(groupDeleteTarget, deleteGroupWithAccounts)
              }
              className={
                deleteGroupWithAccounts
                  ? "bg-red-500 hover:bg-red-400"
                  : "bg-violet-500 hover:bg-violet-400"
              }
            >
              {t.home.confirmDeleteGroup}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(previewAccount)}
        onOpenChange={open => !open && setPreviewAccount(null)}
      >
        <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto border-white/[0.1] bg-[#141419] text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {previewAccount &&
                (previewAccount.avatarUrl ? (
                  <img
                    src={previewAccount.avatarUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="size-10 shrink-0 rounded-xl border border-white/10 object-cover"
                  />
                ) : (
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-sm font-extrabold text-violet-200">
                    {previewAccount.name.slice(0, 1).toUpperCase()}
                  </span>
                ))}
              <span className="min-w-0">
                <span className="block break-all text-base leading-6">
                  {previewAccount?.name}
                </span>
                <span className="mono mt-0.5 block text-[11px] font-normal text-zinc-500">
                  {t.home.accountAge}{" "}
                  {previewAccount
                    ? ageFrom(previewAccount.githubCreatedAt)
                    : "—"}
                  {previewAccount?.githubCreatedAt &&
                    ` · ${t.home.created} ${dateStamp(previewAccount.githubCreatedAt, language)}`}
                </span>
              </span>
            </DialogTitle>
            <DialogDescription className="flex items-center gap-1.5">
              <ShieldCheck size={13} className="text-violet-300" />{" "}
              {t.home.secure}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {previewAccount && (
              <>
                {/* Every row copies on click; values wrap fully instead of truncating. */}
                <PreviewRow
                  label={t.home.username}
                  value={previewAccount.name}
                  onCopy={handleCopy}
                  copyLabel={t.home.copied}
                />
                {normalizeEmails(previewAccount).map(item => (
                  <PreviewRow
                    key={item.value}
                    label={t.home.email}
                    value={item.value}
                    onCopy={handleCopy}
                    copyLabel={t.home.copied}
                  />
                ))}
                <PreviewRow
                  label={t.home.password}
                  value={previewAccount.password}
                  onCopy={handleCopy}
                  copyLabel={t.home.copiedPassword}
                />
                {previewAccount.totpSecret && (
                  <div className="rounded-xl border border-violet-400/25 bg-violet-500/[0.08] px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] font-semibold text-zinc-400">
                        {t.home.currentCode}
                      </span>
                      <span className="mono text-[10px] text-violet-200/70">
                        {secondsLeft}s
                      </span>
                    </div>
                    <p className="mono mt-1 text-xl font-bold tracking-[0.08em] text-violet-100">
                      {formatCode(
                        totpCodes[previewAccount.id]?.current ?? null
                      )}
                    </p>
                  </div>
                )}
                {previewAccount.note && (
                  <PreviewRow
                    label={t.home.note}
                    value={previewAccount.note}
                    onCopy={handleCopy}
                    copyLabel={t.home.copied}
                  />
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function PreviewRow({
  label,
  value,
  onCopy,
  copyLabel,
}: {
  label: string;
  value: string;
  onCopy: (value: string, label: string) => unknown;
  copyLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={() => void onCopy(value, copyLabel)}
      className="group flex w-full items-start justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-left transition hover:border-violet-400/40 hover:bg-white/[0.06]"
    >
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold text-zinc-500">
          {label}
        </span>
        <span className="mt-1 block break-all text-sm leading-5 text-zinc-100">
          {value}
        </span>
      </span>
      <Copy
        size={14}
        className="mt-0.5 shrink-0 text-violet-300/60 transition group-hover:text-violet-300"
      />
    </button>
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
