import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { isRateLimited, isRoomLimited, isTableLimited } from "@/lib/rate-limit";
import { messagesFor, translate } from "@/lib/i18n";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";
import { getLocale } from "@/lib/i18n/server";
import { mailConfigured, sendMail } from "@/lib/mail";
import { buildReceipt, type ReceiptVersion } from "@/lib/receipt";
import { readOrderReceipt, readSlotReceipt, ReceiptReadError, type ReceiptSource } from "@/lib/receipt-source";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidEmail, normalizeEmail } from "@/lib/email";
import { dateLocale } from "@/lib/format";
import { printableReceipt } from "@/lib/print-document";

export const runtime = "nodejs";

/**
 * How many times one order may be emailed in a day.
 *
 * Generous for the honest case — sent, mistyped, sent again, and one spare —
 * and useless as a way to reach strangers from our domain.
 */
const RESENDS_PER_ORDER = 4;

/**
 * POST /api/receipt — a diner asks for their own receipt by email.
 *
 * The address is used for this one message and then forgotten. It is never
 * written to the database: an order row is kept for years as the restaurant's
 * accounting record, so an address stored beside it would outlive its purpose
 * by about that much. What stays is `receipt_sent_at` — a timestamp, which
 * answers "did this order get a receipt?" without keeping anybody's address.
 *
 * That is the whole promise made on the screen where they type it, and it is
 * only worth making if the code keeps it.
 *
 * Rate limited by the room, then by the order's table, then by the order: an
 * open endpoint that sends mail to any address is a way to use our sender to
 * bother strangers.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (await isRoomLimited(req, "receipt", 5)) {
    return await apiError("apiErr.tooManyRequests", 429);
  }

  const body = await jsonBody<{
    orderId?: string;
    orderIds?: string[];
    email?: string;
    delivery?: "print";
    paymentId?: string;
    version?: ReceiptVersion;
  }>(req);
  if (!body) return await apiError("apiErr.invalidRequest", 400);
  const { orderId, orderIds, email } = body;
  const printing = body.delivery === "print";
  const paymentId = typeof body.paymentId === "string" ? body.paymentId : "";
  if ((body.paymentId !== undefined && (!paymentId || paymentId.length > 100))
    || (body.version !== undefined && (!body.version || !Array.isArray(body.version.adjustmentIds)))) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  // One ticket, or every ticket a table settled together. Capped: a table
  // settles a handful of orders, and an uncapped list is a way to make one
  // request read the whole table and build an enormous email.
  // Read as an array only when it is one: JSON can say anything, and a string
  // here once reached `.filter` and answered 500.
  const ids = (Array.isArray(orderIds) && orderIds.length ? orderIds : [orderId])
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .slice(0, 40);
  const address = normalizeEmail(String(email ?? ""));
  if ((!paymentId && ids.length === 0) || (!printing && !isValidEmail(address))) {
    return await apiError("receipt.badEmail", 400);
  }

  // Per ORDER (or slot PAYMENT) as well as per caller. The IP limit alone bounds how fast one
  // machine can send, not how much: anybody holding a single order id could
  // point our sender at any address they liked, five a minute, for as long as
  // they cared to — from our domain, which is the part that gets a sending
  // reputation blocked. A real diner asks for a receipt once, and mistypes the
  // address at most a couple of times.
  for (const id of paymentId ? [paymentId] : ids) {
    if (await isRateLimited(`${printing ? "receipt-print" : "receipt-order"}:${id}`, printing ? 20 : RESENDS_PER_ORDER, 86_400)) {
      return await apiError("apiErr.tooManyRequests", 429);
    }
  }

  const db = createAdminClient();
  let source: ReceiptSource;
  try {
    source = paymentId ? await readSlotReceipt(db, paymentId) : await readOrderReceipt(db, ids, printing, orderIds, body.version);
  } catch (error) {
    return await apiError(error instanceof ReceiptReadError && error.status === 404 ? "apiErr.notFound" : "apiErr.generic",
      error instanceof ReceiptReadError ? error.status : 503);
  }
  // The table is known only now; the room was counted before anything was read.
  if (await isTableLimited(req, "receipt", source.tableId, 5)) {
    return await apiError("apiErr.tooManyRequests", 429);
  }

  const { data: restaurant } = await db
    .from("restaurants")
    .select("name, timezone")
    .eq("id", source.restaurantId)
    .single();

  const locale = await getLocale();
  const messages = messagesFor(locale);
  const t = (key: string, vars?: Record<string, string | number>) =>
    translate(messages, key, vars);

  const receipt = buildReceipt(
    source.orders,
    {
      name: restaurant?.name ?? "TableTap",
      timeZone: restaurant?.timezone ?? DEFAULT_TIME_ZONE,
      locale: dateLocale(locale),
    },
    t,
    source.payment,
  );
  // Slot receipts already have their immutable payment id. Order copies keep
  // the included adjustment ids: an empty list still names the original bill.
  // The print/save path uses the same renderer as POS and email, without
  // sending mail or recording an email timestamp.
  if (printing) return NextResponse.json({ html: printableReceipt(receipt.html, receipt.subject), ...(source.version ? { version: source.version } : {}) });
  const result = await sendMail({
    to: address,
    subject: receipt.subject,
    text: receipt.text,
    html: receipt.html,
    fromName: restaurant?.name ?? "TableTap",
  });

  // Only a timestamp, and only when it actually went. If mail is not
  // configured yet the diner is told plainly rather than thanked for nothing.
  if (result.sent && source.orders.length) {
    await db
      .from("orders")
      .update({ receipt_sent_at: new Date().toISOString() })
      .in("id", source.orders.map(o => o.id))
      .eq("restaurant_id", source.restaurantId);
  }

  if (!result.sent) {
    return await apiError(
      mailConfigured() ? "receipt.failed" : "receipt.notReady",
      503,
    );
  }
  return NextResponse.json({ ok: true, ...(source.version ? { version: source.version } : {}) });
}
