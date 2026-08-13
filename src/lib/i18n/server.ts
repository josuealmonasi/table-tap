import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "./index";

/**
 * The active locale for a server render.
 *
 * A saved choice wins — someone who picked a language keeps it. Otherwise a
 * browser asking for English gets English, which is what a visitor's phone
 * does. Everything else, including a browser that says nothing, gets Spanish:
 * the diners this is built for are in Mexico, and English was only ever the
 * default because it was written first.
 */
export async function getLocale(): Promise<Locale> {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  const accept = (await headers()).get("accept-language")?.toLowerCase() ?? "";
  if (accept.startsWith("es")) return "es";
  if (accept.startsWith("en")) return "en";
  return DEFAULT_LOCALE;
}
