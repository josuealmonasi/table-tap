import { en, type Messages } from "./en";
import { es } from "./es";

export type Locale = "en" | "es";
export const LOCALES: Locale[] = ["en", "es"];
export const LOCALE_COOKIE = "tt-locale";
export type { Messages };

/** Display metadata for the language switcher. Add a row here to offer a new language. */
export const LOCALE_LABELS: Record<Locale, { flag: string; name: string; short: string }> = {
  en: { flag: "🇺🇸", name: "English", short: "EN" },
  es: { flag: "🇲🇽", name: "Español", short: "ES" },
};

const DICTS: Record<Locale, Messages> = { en, es };

/** The message catalog for a locale (English if somehow unknown). */
export function messagesFor(locale: Locale): Messages {
  return DICTS[locale] ?? en;
}

export function isLocale(value: string | null | undefined): value is Locale {
  return value === "en" || value === "es";
}

/**
 * Resolves a dotted message key (e.g. "cart.proceed") against a catalog and
 * fills in {vars}. Returns the key itself if it's missing, so a gap is visible
 * rather than crashing.
 */
export function translate(
  messages: Messages,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const raw = key
    .split(".")
    .reduce<unknown>(
      (obj, k) =>
        obj && typeof obj === "object" ? (obj as Record<string, unknown>)[k] : undefined,
      messages,
    );
  if (typeof raw !== "string") return key;
  if (!vars) return raw;
  return Object.entries(vars).reduce(
    (str, [k, v]) => str.replaceAll(`{${k}}`, String(v)),
    raw,
  );
}
