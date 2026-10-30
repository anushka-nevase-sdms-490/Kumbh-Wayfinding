import { createContext, useContext } from "react";
import type { QrNode } from "../lib/types";
import type { Lang, MessageKey, Vars } from "./messages";

export type I18n = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: MessageKey, vars?: Vars) => string;
  dist: (m: number) => string;
  /** Place name to show first: the Devanagari name in Hindi/Marathi when there is one. */
  placeLabel: (n: Pick<QrNode, "name" | "local_name">) => string;
  /** The other name, shown smaller (or null). */
  placeAltLabel: (n: Pick<QrNode, "name" | "local_name">) => string | null;
};

export const I18nContext = createContext<I18n | null>(null);

export function useI18n(): I18n {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside LangProvider");
  return ctx;
}
