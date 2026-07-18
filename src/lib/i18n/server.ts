import { cookies, headers } from "next/headers";
import { isLocale, LOCALE_COOKIE, type Locale } from "./index";

/**
 * The active locale for a server render: the saved cookie first, otherwise the
 * browser's Accept-Language (Spanish → es), defaulting to English.
 */
export async function getLocale(): Promise<Locale> {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  const accept = (await headers()).get("accept-language")?.toLowerCase() ?? "";
  return accept.startsWith("es") ? "es" : "en";
}
