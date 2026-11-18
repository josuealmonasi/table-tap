import { en, type Messages } from "./en";
import { es } from "./es";

export type Locale = "en" | "es";
export const LOCALES: Locale[] = ["en", "es"];

/**
 * What we serve when nothing says otherwise.
 *
 * TableTap launches in Mexico, so Spanish is the assumption and English is the
 * exception a browser has to ask for. Every fallback in the app reads this,
 * rather than each picking its own.
 */
export const DEFAULT_LOCALE: Locale = "es";
export const LOCALE_COOKIE = "tt-locale";
export type { Messages };

/** Display metadata for the language switcher. Add a row here to offer a new language. */
export const LOCALE_LABELS: Record<
  Locale,
  { flag: string; name: string; short: string }
> = {
  en: { flag: "🇺🇸", name: "English", short: "EN" },
  es: { flag: "🇲🇽", name: "Español", short: "ES" },
};

const DICTS: Record<Locale, Messages> = { en, es };

/** The message catalog for a locale, falling back to the default. */
export function messagesFor(locale: Locale): Messages {
  return DICTS[locale] ?? DICTS[DEFAULT_LOCALE];
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

/**
 * The locale a request was made in: the saved choice, else Spanish. The same
 * rule as `getLocale()`, read from the request so a route can use it without
 * `next/headers` (and unit tests can call it).
 */
export function requestLocale(req: { cookies: { get(name: string): { value: string } | undefined } }): Locale {
  const value = req.cookies.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

