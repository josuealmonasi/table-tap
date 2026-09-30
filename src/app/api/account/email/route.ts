import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientKey, isRateLimited } from "@/lib/rate-limit";
import { cleanEmail, normalizeCode, accountLink } from "@/lib/accounts";
import { accountByCode, statementOf } from "@/lib/accounts-server";
import { statementMail } from "@/lib/account-mail";
import { mailConfigured, sendMail } from "@/lib/mail";
import { getLocale } from "@/lib/i18n/server";
import { messagesFor, translate } from "@/lib/i18n";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";

export const runtime = "nodejs";

// POST /api/account/email — the statement to an address the customer types.
// The address is used for this one message and never written down, the same
// promise the receipts make: holding the code is what lets a statement be
// sent, and a sent statement names nobody's address anywhere we keep.
export async function POST(req: NextRequest): Promise<NextResponse> {
  // A statement is a message to a stranger's inbox with the restaurant's name
  // on it: few, so the code cannot be used to mail somebody a hundred times.
  if (await isRateLimited(`account-mail:${clientKey(req)}`, 3, 600)) {
    return await apiError("apiErr.tooManyWait", 429);
  }
  if (!mailConfigured()) return await apiError("apiErr.mailOff", 409);

  const body = await jsonBody<{ c?: unknown; email?: unknown }>(req);
  const code = normalizeCode(typeof body?.c === "string" ? body.c : "");
  const email = cleanEmail(body?.email);
  if (!code) return await apiError("apiErr.invalidRequest", 400);
  if (!email || email === "bad") return await apiError("apiErr.email", 400);

  const account = await accountByCode(code).catch(() => undefined);
  if (account === undefined) return await apiError("apiErr.generic", 500);
  if (!account) return await apiError("account.notFound", 404);

  const { data: restaurant } = await createAdminClient()
    .from("restaurants").select("name, currency, timezone").eq("id", account.restaurant_id).maybeSingle();
  if (!restaurant) return await apiError("apiErr.generic", 500);
  const statement = await statementOf(account, restaurant.timezone).catch(() => null);
  if (!statement) return await apiError("apiErr.generic", 500);

  const locale = await getLocale();
  const messages = messagesFor(locale);
  const origin = req.headers.get("origin") ?? new URL(req.url).origin;
  const mail = statementMail(
    statement,
    {
      restaurant: restaurant.name,
      name: account.name,
      currency: restaurant.currency,
      link: accountLink(origin, code),
      locale,
      timeZone: restaurant.timezone ?? DEFAULT_TIME_ZONE,
    },
    (key, vars) => translate(messages, key, vars),
  );
  const sent = await sendMail({ to: email, subject: mail.subject, text: mail.text, html: mail.html, fromName: restaurant.name });
  if (!sent.sent) return await apiError("apiErr.mailFailed", 502);
  return NextResponse.json({ ok: true });
}
