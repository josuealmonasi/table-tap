import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientKey, isRateLimited } from "@/lib/rate-limit";
import { normalizeCode } from "@/lib/accounts";
import { accountByCode, statementOf } from "@/lib/accounts-server";
import { mailConfigured } from "@/lib/mail";

export const runtime = "nodejs";

// GET /api/account?c=… — a customer's statement, by the code on its QR.
//
// What it answers is what the statement itself shows the customer: the
// restaurant, the name on the account, what is owed day by day, and what was
// paid before. Not the ceiling, not the email, not who on the staff charged
// what, and no row id: holding the code lets you read and pay, nothing else.
export async function GET(req: NextRequest): Promise<NextResponse> {
  // Sixty bits cannot be walked, but a page that answers "no such account" as
  // fast as it is asked is still an oracle.
  if (await isRateLimited(`account:${clientKey(req)}`, 20, 60)) {
    return await apiError("apiErr.tooManyWait", 429);
  }
  const code = normalizeCode(req.nextUrl.searchParams.get("c") ?? "");
  if (!code) return await apiError("account.invalid", 400);

  const account = await accountByCode(code).catch(() => undefined);
  if (account === undefined) return await apiError("apiErr.generic", 500);
  if (!account) return await apiError("account.notFound", 404);

  const { data: restaurant, error } = await createAdminClient()
    .from("restaurants")
    .select("id, name, logo, logo_url, currency, timezone, stripe_account_id, stripe_charges_enabled")
    .eq("id", account.restaurant_id)
    .maybeSingle();
  if (error || !restaurant) return await apiError("apiErr.generic", 500);

  const statement = await statementOf(account, restaurant.timezone).catch(() => null);
  if (!statement) return await apiError("apiErr.generic", 500);

  return NextResponse.json({
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      logo: restaurant.logo,
      logo_url: restaurant.logo_url,
      currency: restaurant.currency,
    },
    name: account.name,
    status: account.status,
    owed: statement.owed,
    // Without the order ids: row ids are nobody's business outside the staff.
    days: statement.days.map(d => ({
      ...d,
      charges: d.charges.map(c => ({ at: c.at, tableLabel: c.tableLabel, lines: c.lines, total: c.total })),
    })),
    payments: statement.payments,
    // A yes or a no: the Stripe columns are not the customer's to read.
    cardsEnabled: Boolean(restaurant.stripe_account_id && restaurant.stripe_charges_enabled),
    payingOnline: Boolean(account.checkout_until && new Date(account.checkout_until) > new Date()),
    // Only offered where a message can actually be sent.
    canEmail: mailConfigured(),
    timeZone: restaurant.timezone,
  });
}
