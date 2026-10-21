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
import { siteOrigin } from "@/lib/site-origin";

export const runtime = "nodejs";

/** Sent, mistyped, sent again and one spare, the same allowance as a receipt. */
const STATEMENTS_PER_ACCOUNT = 4;
/** A busy restaurant's honest day, and a ceiling on what its codes can send. */
const STATEMENTS_PER_RESTAURANT = 100;

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
  // And few per account, and per restaurant. The address limit alone let one
  // person holding one code mail the statement about 400 times a day, to the
  // same stranger, from our sender; more addresses meant more allowances. Kept
  // on the account and the restaurant, never on the recipient: a limit on the
  // address typed would have to store something about a stranger's inbox.
  if (await isRateLimited(`account-mail-account:${account.id}`, STATEMENTS_PER_ACCOUNT, 86_400)
    || await isRateLimited(`account-mail-restaurant:${account.restaurant_id}`, STATEMENTS_PER_RESTAURANT, 86_400)) {
    return await apiError("apiErr.tooManyWait", 429);
  }

  const { data: restaurant } = await createAdminClient()
    .from("restaurants").select("name, currency, timezone").eq("id", account.restaurant_id).maybeSingle();
  if (!restaurant) return await apiError("apiErr.generic", 500);
  const statement = await statementOf(account, restaurant.timezone).catch(() => null);
  if (!statement) return await apiError("apiErr.generic", 500);

  const locale = await getLocale();
  const messages = messagesFor(locale);
  const origin = siteOrigin(req);
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
