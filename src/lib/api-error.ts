import { NextResponse } from "next/server";
import { messagesFor, translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

/**
 * A JSON error whose message is in the caller's language.
 *
 * API routes used to return English sentences, which the dashboard then put
 * straight into a toast — so a Spanish owner got "Enter the combo price." no
 * matter what the interface was set to. The locale is already available on the
 * server (cookie first, then Accept-Language), so the message is resolved here
 * rather than shipping a code the client has to know how to render.
 *
 * @param key    an i18n key, e.g. "apiErr.comboPrice"
 * @param status HTTP status, defaulting to 400 — these are mostly validation
 * @param vars   substitutions for the message
 */
export async function apiError(
  key: string,
  status = 400,
  vars?: Record<string, string | number>,
): Promise<NextResponse> {
  const messages = messagesFor(await getLocale());
  return NextResponse.json({ error: translate(messages, key, vars) }, { status });
}
