import type { AppLanguage } from "@/lib/types";
import en from "./locales/en";
import fi from "./locales/fi";
import fil from "./locales/fil";
import fr from "./locales/fr";
import it from "./locales/it";
import ja from "./locales/ja";
import ko from "./locales/ko";
import pt from "./locales/pt";
import ru from "./locales/ru";
import vi from "./locales/vi";
import zhCN from "./locales/zh-CN";
import zhTW from "./locales/zh-TW";
import es from "./locales/es";

export type Dictionary = typeof en;

/**
 * The English file is the shape contract: assigning the record to
 * Record<AppLanguage, Dictionary> makes TypeScript flag any locale
 * whose keys drift out of sync.
 */
export const dictionaries: Record<AppLanguage, Dictionary> = {
  en,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  ja,
  ko,
  ru,
  fr,
  vi,
  es,
  it,
  pt,
  fi,
  fil,
};
