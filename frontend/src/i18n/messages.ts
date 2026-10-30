/** Pure translation helpers (no React) — used by the UI and the tests. */
import { en, type MessageKey } from "./en";
import { hi } from "./hi";
import { mr } from "./mr";

export type Lang = "en" | "hi" | "mr";
export const LANGS: { id: Lang; label: string }[] = [
  { id: "en", label: "English" },
  { id: "hi", label: "हिंदी" },
  { id: "mr", label: "मराठी" },
];

const CATALOGS = { en, hi, mr };

export type Vars = Record<string, string | number>;

export function translate(lang: Lang, key: MessageKey, vars: Vars = {}): string {
  const text: string = CATALOGS[lang][key] ?? en[key];
  return text.replace(/\{(\w+)\}/g, (all, name: string) =>
    name in vars ? String(vars[name]) : all
  );
}

/** "120 m" / "1.4 km" (मी / किमी) — Latin digits in every language. */
export function formatDist(lang: Lang, m: number): string {
  return m >= 1000
    ? translate(lang, "unit.km", { n: (m / 1000).toFixed(1) })
    : translate(lang, "unit.m", { n: Math.round(m) });
}

/** Phone language → app language (Marathi, then Hindi, else English). */
export function guessLang(languages: readonly string[]): Lang {
  for (const l of languages) {
    const code = l.toLowerCase().slice(0, 2);
    if (code === "mr" || code === "hi" || code === "en") return code;
  }
  return "en";
}

export type { MessageKey };
