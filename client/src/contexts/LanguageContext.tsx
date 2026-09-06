import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AppLanguage } from "@/lib/types";
import { dictionaries, type Dictionary } from "@/lib/i18n";
import {
  LANGUAGES,
  detectSystemLanguage,
  loadStoredLanguage,
  storeLanguage,
} from "@/lib/i18n/config";

type LanguageContextValue = {
  language: AppLanguage;
  /** Native labels for the settings selector, independent of the active locale. */
  languages: typeof LANGUAGES;
  t: Dictionary;
  setLanguage: (language: AppLanguage) => void;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Seeded from a previous explicit choice, otherwise from the OS language.
  const [language, setLanguageState] =
    useState<AppLanguage>(loadStoredLanguage);

  const setLanguage = useCallback((next: AppLanguage) => {
    setLanguageState(next);
    storeLanguage(next);
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      languages: LANGUAGES,
      t: dictionaries[language] ?? dictionaries[detectSystemLanguage()],
      setLanguage,
    }),
    [language, setLanguage]
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context)
    throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}
