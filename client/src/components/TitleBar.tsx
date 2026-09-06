/* Visual direction: "加密索引库" — graphite window chrome, one violet index line.
   Toolbar geometry follows the Veil shell: the brand sits above the sidebar, the
   vault search lives in the middle, and 34×30 caption controls (minimize /
   fullscreen / close) close the row on the right. */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronLeft, Minus, Plus, Search, Square, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import VaultMark from "@/components/VaultMark";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  clearGroupFilterFromShell,
  openCreateAccountFromShell,
  setShellSearch,
  useShellGroupHint,
  useShellSearch,
  useShellSearchPlaceholder,
  useShellUnlocked,
  useSidebarCollapsed,
} from "@/lib/shellStore";

const isTauriRuntime = "__TAURI_INTERNALS__" in window;

/**
 * getCurrentWindow() reads the Tauri internals synchronously and throws outside the
 * desktop runtime. Window chrome must never be able to take the vault UI down with it,
 * so the handle is resolved once and every call site tolerates its absence.
 */
const appWindow = (() => {
  try {
    return isTauriRuntime ? getCurrentWindow() : null;
  } catch {
    return null;
  }
})();

function CaptionButton({
  label,
  onClick,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-[30px] w-[34px] shrink-0 place-items-center rounded-[9px] text-zinc-400 transition-colors ${
        danger
          ? "hover:bg-red-500/[0.16] hover:text-red-200"
          : "hover:bg-white/[0.08] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

export default function TitleBar() {
  const { t } = useLanguage();
  const a = t.app;
  const collapsed = useSidebarCollapsed();
  const unlocked = useShellUnlocked();
  const search = useShellSearch();
  const searchPlaceholder = useShellSearchPlaceholder();
  const groupHint = useShellGroupHint();
  const [maximized, setMaximized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const syncMaximized = useCallback(() => {
    appWindow
      ?.isMaximized()
      .then(setMaximized)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!appWindow) return;
    syncMaximized();
    // The webview is resized whenever the window is maximized, restored or snapped,
    // so the DOM event is enough and no Tauri event permission has to be granted.
    window.addEventListener("resize", syncMaximized);
    return () => window.removeEventListener("resize", syncMaximized);
  }, [syncMaximized]);

  const toggleMaximize = useCallback(() => {
    appWindow
      ?.toggleMaximize()
      .then(syncMaximized)
      .catch(() => undefined);
  }, [syncMaximized]);

  const toggleFullscreen = useCallback(() => {
    if (!appWindow) return;
    appWindow
      .isFullscreen()
      .then(value => {
        setFullscreen(!value);
        return appWindow!.setFullscreen(!value);
      })
      .catch(() => undefined);
  }, []);

  function handleDragSurface(event: React.MouseEvent<HTMLElement>) {
    if (!appWindow || event.button !== 0) return;
    // Interactive chrome (search field, buttons) must not start a window drag.
    if ((event.target as HTMLElement).closest("input, button, a")) return;
    // startDragging swallows the follow-up click, so the double-click has to be
    // recognised from the click count before dragging begins.
    if (event.detail === 2) {
      toggleMaximize();
      return;
    }
    appWindow.startDragging().catch(() => undefined);
  }

  // When the vault sidebar collapses, the brand column narrows with it.
  const brandNarrow = unlocked && collapsed;

  return (
    <>
      <header
        onMouseDown={handleDragSurface}
        style={
          {
            "--shell-brand-width": brandNarrow
              ? "var(--shell-sidebar-collapsed)"
              : "var(--shell-sidebar)",
          } as React.CSSProperties
        }
        className="relative z-30 flex h-[var(--titlebar-height)] shrink-0 items-stretch bg-[#0b0b0e] select-none"
      >
        <div className="shell-brand flex min-w-0 items-center gap-2.5 pl-3">
          <VaultMark className="h-7 w-7" />
          {!brandNarrow && (
            <>
              <span className="shrink-0 text-[12px] font-bold tracking-[-0.01em] text-zinc-200">
                Github Auth
              </span>
              <span className="hidden shrink-0 items-center gap-1.5 rounded-md border border-white/[0.07] px-2 py-[3px] text-[10px] font-medium text-zinc-500 sm:inline-flex">
                <i className="h-[5px] w-[5px] rounded-full bg-violet-400" />
                {a.localEncrypted}
              </span>
            </>
          )}
        </div>
        {/* Group pointer sits in the toolbar above the index header — after the
            brand, well away from the centered search field. */}
        {unlocked && groupHint && (
          <button
            type="button"
            onClick={clearGroupFilterFromShell}
            title={a.backToAllAccounts}
            aria-label={a.backToAllAccounts}
            className="ml-1 inline-flex h-8 shrink-0 items-center gap-1.5 self-center rounded-full border border-violet-400/25 bg-violet-500/10 py-0 pl-1.5 pr-2.5 text-[11px] font-semibold text-violet-200 transition hover:bg-violet-500/20"
          >
            <ChevronLeft size={12} className="text-violet-300/80" />
            <i
              className="size-1.5 rounded-full"
              style={{ backgroundColor: groupHint.color }}
            />
            <span className="max-w-[140px] truncate">{groupHint.name}</span>
          </button>
        )}
        {unlocked && (
          <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 px-3">
            <div className="relative w-full max-w-[560px]">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600"
              />
              <Input
                value={search}
                onChange={event => setShellSearch(event.target.value)}
                placeholder={searchPlaceholder}
                className="h-9 rounded-[10px] border-white/[0.08] bg-white/[0.035] pl-9 pr-8 text-sm placeholder:text-zinc-600 focus-visible:ring-violet-400/50"
              />
              {search && (
                <button
                  onClick={() => setShellSearch("")}
                  aria-label={a.clearSearch}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={openCreateAccountFromShell}
              aria-label={a.addAccount}
              title={a.addAccount}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-violet-500 px-3 text-[13px] font-bold text-white transition hover:bg-violet-400"
            >
              <Plus size={15} />
              {a.addAccount}
            </button>
          </div>
        )}
        {/* Without the search cluster (locked screen) this spacer keeps the
            caption controls pinned to the right edge. */}
        {!unlocked && <div className="min-w-0 flex-1 self-stretch" />}
        <div className="flex shrink-0 items-center pl-2 pr-2.5">
          <div className="flex items-center gap-[2px]">
            <CaptionButton
              label={a.minimize}
              onClick={() => appWindow?.minimize().catch(() => undefined)}
            >
              <Minus size={17} />
            </CaptionButton>
            <CaptionButton
              label={fullscreen ? a.exitFullscreen : a.fullscreen}
              onClick={toggleFullscreen}
            >
              <Square size={14} />
            </CaptionButton>
            <CaptionButton
              danger
              label={a.close}
              onClick={() => appWindow?.close().catch(() => undefined)}
            >
              <X size={17} />
            </CaptionButton>
          </div>
        </div>
        {/* Hairline starts where the sidebar ends, like the Veil toolbar. */}
        <div className="shell-topline pointer-events-none absolute bottom-0 h-px bg-white/[0.06]" />
        <div className="shell-topline pointer-events-none absolute bottom-0 h-px bg-gradient-to-r from-transparent via-violet-500/30 to-transparent" />
      </header>
      {isTauriRuntime && !maximized && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[100] border border-white/[0.09]"
        />
      )}
    </>
  );
}
