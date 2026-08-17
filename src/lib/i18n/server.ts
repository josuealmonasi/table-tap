import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "./index";

/**
 * The active locale for a server render.
 *
 * A saved choice wins — someone who picked a language keeps it. Everyone else
 * gets Spanish, including a phone whose browser asks for English: this ships
 * in Mexico, the menu is read at a Mexican table, and a restaurant that looks
 * English on arrival looks like the wrong restaurant. The header's toggle is
 * one tap away for anyone who wants the other language, and taking it is
 * remembered.
 */
export async function getLocale(): Promise<Locale> {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  return DEFAULT_LOCALE;
}
