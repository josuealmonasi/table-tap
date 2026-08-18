import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { messagesFor, translate } from "@/lib/i18n";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";
import { getLocale } from "@/lib/i18n/server";
import { mailConfigured, sendMail } from "@/lib/mail";
import { buildReceipt } from "@/lib/receipt";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/receipt — a diner asks for their own receipt by email.
 *
 * The address is used for this one message and stored on the order it belongs
 * to. It is not a list, we never write again, and nothing about the diner goes
 * anywhere else — that is the whole promise made on the screen where they type
 * it, and it is only worth making if the code keeps it.
 *
 * Rate limited by IP: an open endpoint that sends mail to any address is a way
 * to use our sender to bother strangers.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (await isRateLimited(`receipt:${clientIp(req)}`, 5, 60)) {
    return await apiError("apiErr.tooManyRequests", 429);
  }

  const { orderId, orderIds, email } = (await req.json().catch(() => ({}))) as {
    orderId?: string;
    orderIds?: string[];
    email?: string;
  };
  // One ticket, or every ticket a table settled together. Capped: a table
  // settles a handful of orders, and an uncapped list is a way to make one
  // request read the whole table and build an enormous email.
  const ids = (orderIds?.length ? orderIds : [orderId])
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .slice(0, 40);
  const address = String(email ?? "").trim().toLowerCase();
  if (ids.length === 0 || !EMAIL.test(address) || address.length > 200) {
    return await apiError("receipt.badEmail", 400);
  }

  const db = createAdminClient();
  const { data: found } = await db
    .from("orders")
    .select(
      "id, restaurant_id, items, subtotal, discount, service_fee, tip, total, currency, table_label, created_at, pay_method, paid",
    )
    .in("id", ids)
    .order("created_at", { ascending: true });

  // Knowing the order's unguessable id is what proves this is your order —
  // the same trust boundary the tracker already uses.
  // One receipt is one restaurant's bill. Ids from two restaurants would
  // otherwise be added together and sent out under whichever name came first.
  const first = found?.[0];
  const orders = (found ?? []).filter(o => o.restaurant_id === first?.restaurant_id);
  if (orders.length === 0) return await apiError("apiErr.notFound", 404);
  const order = orders[0];

  const { data: restaurant } = await db
    .from("restaurants")
    .select("name, timezone")
    .eq("id", order.restaurant_id)
    .single();

  const locale = await getLocale();
  const messages = messagesFor(locale);
  const t = (key: string, vars?: Record<string, string | number>) =>
    translate(messages, key, vars);

  const receipt = buildReceipt(
    orders,
    {
      name: restaurant?.name ?? "TableTap",
      timeZone: restaurant?.timezone ?? DEFAULT_TIME_ZONE,
      locale: locale === "es" ? "es-MX" : "en-US",
    },
    t,
  );
  const result = await sendMail({
    to: address,
    subject: receipt.subject,
    text: receipt.text,
    html: receipt.html,
    fromName: restaurant?.name ?? "TableTap",
  });

  // Recorded either way. If mail is not configured yet the diner is told
  // plainly rather than thanked for nothing, and the address is still on the
  // order so it can be sent the moment sending works.
  await db
    .from("orders")
    .update(
      result.sent
        ? { receipt_email: address, receipt_sent_at: new Date().toISOString() }
        : // A failed retry must not erase the record of one that worked.
          { receipt_email: address },
    )
    .in("id", orders.map(o => o.id))
    .eq("restaurant_id", order.restaurant_id);

  if (!result.sent) {
    return await apiError(
      mailConfigured() ? "receipt.failed" : "receipt.notReady",
      503,
    );
  }
  return NextResponse.json({ ok: true });
}
