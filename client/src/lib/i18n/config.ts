import type { AppLanguage } from "@/lib/types";

export const LANGUAGES: { code: AppLanguage; label: string }[] = [
  { code: "zh-CN", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "ru", label: "Русский" },
  { code: "fr", label: "Français" },
  { code: "vi", label: "Tiếng Việt" },
  { code: "es", label: "Español" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "fi", label: "Suomi" },
  { code: "fil", label: "Filipino" },
];

export const DEFAULT_LANGUAGE: AppLanguage = "en";
export const LANGUAGE_STORAGE_KEY = "githubauth.language";

export function isAppLanguage(value: unknown): value is AppLanguage {
  return LANGUAGES.some(language => language.code === value);
}

/**
 * First launch follows the OS language: the WebView reports the Windows display
 * language through navigator.languages, so no extra IPC is needed. An explicit
 * choice made in Vault settings is persisted in localStorage and wins forever.
 */
export function detectSystemLanguage(): AppLanguage {
  const candidates =
    typeof navigator !== "undefined"
      ? [...(navigator.languages ?? []), navigator.language]
      : [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const tag = candidate.toLowerCase();
    if (tag.startsWith("zh")) {
      // Traditional-script regions default to Traditional Chinese.
      return tag.includes("tw") ||
        tag.includes("hk") ||
        tag.includes("mo") ||
        tag.includes("hant")
        ? "zh-TW"
        : "zh-CN";
    }
    if (tag.startsWith("en")) return "en";
    if (tag.startsWith("ja")) return "ja";
    if (tag.startsWith("ko")) return "ko";
    if (tag.startsWith("ru")) return "ru";
    if (tag.startsWith("fr")) return "fr";
    if (tag.startsWith("vi")) return "vi";
    if (tag.startsWith("es")) return "es";
    if (tag.startsWith("it")) return "it";
    if (tag.startsWith("pt")) return "pt";
    if (tag.startsWith("fi")) return "fi";
    if (tag.startsWith("fil") || tag.startsWith("tl")) return "fil";
  }
  return DEFAULT_LANGUAGE;
}

export function loadStoredLanguage(): AppLanguage {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isAppLanguage(stored)) return stored;
  } catch {
    // localStorage can be unavailable in restricted webview contexts.
  }
  return detectSystemLanguage();
}

export function storeLanguage(language: AppLanguage) {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Ignore persistence failures; the choice still applies to this session.
  }
}
