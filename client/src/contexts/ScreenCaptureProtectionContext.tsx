import { invoke } from "@tauri-apps/api/core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const PROTECTION_STORAGE_KEY = "githubauth.screenCaptureProtection";
const NOTICE_STORAGE_KEY = "githubauth.screenCaptureNoticeAcknowledged.v1";
const isTauriRuntime = "__TAURI_INTERNALS__" in window;

export type ScreenCaptureProtectionStatus =
  | "applying"
  | "active"
  | "inactive"
  | "unavailable";

type ScreenCaptureProtectionContextValue = {
  enabled: boolean;
  status: ScreenCaptureProtectionStatus;
  noticeOpen: boolean;
  setEnabled: (enabled: boolean) => void;
  dismissNotice: (doNotShowAgain: boolean) => void;
};

const ScreenCaptureProtectionContext =
  createContext<ScreenCaptureProtectionContextValue | null>(null);

function readProtectionPreference() {
  try {
    return localStorage.getItem(PROTECTION_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

function shouldShowNotice() {
  try {
    return localStorage.getItem(NOTICE_STORAGE_KEY) !== "1";
  } catch {
    return true;
  }
}

export function ScreenCaptureProtectionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [enabled, setEnabledState] = useState(readProtectionPreference);
  const [status, setStatus] =
    useState<ScreenCaptureProtectionStatus>("applying");
  const [noticeOpen, setNoticeOpen] = useState(
    () => isTauriRuntime && shouldShowNotice()
  );

  useEffect(() => {
    let current = true;
    if (!isTauriRuntime) {
      setStatus("unavailable");
      return () => {
        current = false;
      };
    }

    setStatus("applying");
    invoke<void>("set_screen_capture_protection", { enabled })
      .then(() => {
        if (current) setStatus(enabled ? "active" : "inactive");
      })
      .catch(() => {
        if (current) setStatus("unavailable");
      });

    return () => {
      current = false;
    };
  }, [enabled]);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    try {
      localStorage.setItem(PROTECTION_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // The native setting still applies for this session.
    }
  }, []);

  const dismissNotice = useCallback((doNotShowAgain: boolean) => {
    setNoticeOpen(false);
    if (!doNotShowAgain) return;
    try {
      localStorage.setItem(NOTICE_STORAGE_KEY, "1");
    } catch {
      // The dialog is still dismissed for this session.
    }
  }, []);

  const value = useMemo<ScreenCaptureProtectionContextValue>(
    () => ({ enabled, status, noticeOpen, setEnabled, dismissNotice }),
    [dismissNotice, enabled, noticeOpen, setEnabled, status]
  );

  return (
    <ScreenCaptureProtectionContext.Provider value={value}>
      {children}
    </ScreenCaptureProtectionContext.Provider>
  );
}

export function useScreenCaptureProtection() {
  const context = useContext(ScreenCaptureProtectionContext);
  if (!context) {
    throw new Error(
      "useScreenCaptureProtection must be used within ScreenCaptureProtectionProvider"
    );
  }
  return context;
}
