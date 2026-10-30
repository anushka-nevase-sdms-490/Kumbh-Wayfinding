import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { QrNode } from "../lib/types";
import { I18nContext, type I18n } from "./context";
import { formatDist, guessLang, translate, type Lang } from "./messages";

const STORAGE_KEY = "setu-lang";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "hi" || saved === "mr") return saved;
  } catch {
    /* private mode */
  }
  return guessLang(typeof navigator !== "undefined" ? navigator.languages ?? [] : []);
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode: the choice lasts until reload */
    }
  }, []);

  // Screen readers and font choice follow the page language.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<I18n>(() => {
    const local = (n: Pick<QrNode, "name" | "local_name">) =>
      lang !== "en" && n.local_name?.trim() ? n.local_name.trim() : null;
    return {
      lang,
      setLang,
      t: (key, vars) => translate(lang, key, vars),
      dist: (m) => formatDist(lang, m),
      placeLabel: (n) => local(n) ?? n.name,
      placeAltLabel: (n) => (local(n) ? n.name : n.local_name?.trim() || null),
    };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
