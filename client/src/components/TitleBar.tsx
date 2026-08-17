/* Visual direction: "加密索引库" — graphite window chrome, one violet index line, native Win11 caption geometry. */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useState } from "react";

const LOGO = "./assets/github-vault-logo_fdf70cb3.png";

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

/** Win11 caption glyphs are 10×10 hairlines, not rounded icon-font shapes. */
function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 10 10"
      width="10"
      height="10"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      shapeRendering="crispEdges"
    >
      {children}
    </svg>
  );
}

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
      className={`grid h-full w-[46px] shrink-0 place-items-center text-zinc-400 transition-colors ${
        danger
          ? "hover:bg-[#c42b1c] hover:text-white"
          : "hover:bg-white/[0.08] hover:text-white"
      }`}
    >
      <Glyph>{children}</Glyph>
    </button>
  );
}

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);

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

  function handleDragSurface(event: React.MouseEvent<HTMLDivElement>) {
    if (!appWindow || event.button !== 0) return;
    // startDragging swallows the follow-up click, so the double-click has to be
    // recognised from the click count before dragging begins.
    if (event.detail === 2) {
      toggleMaximize();
      return;
    }
    appWindow.startDragging().catch(() => undefined);
  }

  return (
    <>
      <header className="relative z-30 flex h-[var(--titlebar-height)] shrink-0 items-stretch border-b border-white/[0.08] bg-[#0b0b0e] select-none">
        <div
          onMouseDown={handleDragSurface}
          className="flex min-w-0 flex-1 items-center gap-2.5 pl-3"
        >
          <img
            src={LOGO}
            alt=""
            aria-hidden="true"
            className="h-[18px] w-[18px] shrink-0 rounded-[5px]"
          />
          <span className="shrink-0 text-[12px] font-bold tracking-[-0.01em] text-zinc-200">
            Github Auth
          </span>
          <span className="hidden shrink-0 items-center gap-1.5 rounded-md border border-white/[0.07] px-2 py-[3px] text-[10px] font-medium text-zinc-500 sm:inline-flex">
            <i className="h-[5px] w-[5px] rounded-full bg-violet-400" />
            本地加密
          </span>
        </div>
        {isTauriRuntime && (
          <div className="flex shrink-0 items-stretch">
            <CaptionButton
              label="最小化"
              onClick={() => appWindow?.minimize().catch(() => undefined)}
            >
              <path d="M0.5 5H9.5" />
            </CaptionButton>
            <CaptionButton
              label={maximized ? "向下还原" : "最大化"}
              onClick={toggleMaximize}
            >
              {maximized ? (
                <>
                  <rect x="0.5" y="2.5" width="7" height="7" />
                  <path d="M2.5 2.5V0.5H9.5V7.5H7.5" />
                </>
              ) : (
                <rect x="0.5" y="0.5" width="9" height="9" />
              )}
            </CaptionButton>
            <CaptionButton
              danger
              label="关闭"
              onClick={() => appWindow?.close().catch(() => undefined)}
            >
              <path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" />
            </CaptionButton>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-violet-500/30 to-transparent" />
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
