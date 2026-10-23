import { orderRequestScope } from "@/lib/order-request";
import { apiError } from "@/lib/api-error";
import { NextResponse } from "next/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import { orderCode, type OrderLineItem } from "@/lib/types";

/** What the till sends when a cashier rings a sale. */
export interface PosSaleBody {
  posRef?: string;
  collectorContext?: unknown;
  /** The restaurant the till screen was opened for — the drawer the money is in. */
  restaurantId?: unknown;
  /** A replayed sale: the currency it was charged in. */
  currency?: unknown;
  /** The money already collected, saved before the first send. */
  collected?: unknown;
  items?: OrderLineItem[];
  method?: "cash" | "card" | "account";
  /** With `method: "account"`: the customer account the sale goes on. */
  accountId?: string;
  customerName?: string;
  email?: string;
  note?: string;
  tipPct?: number;
  tipAmount?: number;
  /** The customer declined the ticket: build nothing. */
  noReceipt?: boolean;
  /**
   * With `method: "card"`: the voucher's authorization or folio number, to
   * find the sale it paid. Never anything from the card itself — the privacy
   * notice says no card data is stored, and the field asks for none.
   */
  terminalRef?: string;
}

/** A voucher reference as typed: trimmed, 1–40 characters, or nothing. */
export function terminalRef(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const ref = raw.trim().replace(/\s+/g, " ");
  return ref.length >= 1 && ref.length <= 40 ? ref : null;
}

/**
 * A till screen opened for one restaurant, sending while the browser is now
 * signed in to another. Another tab signing in replaces the session cookie
 * under an open till, and the server used to file the sale under whoever was
 * signed in: restaurant A's cash recorded as restaurant B's takings, and A's
 * device told the sale was safe. Refused, and kept on the device (`held`)
 * until A signs in again. A till that sends no restaurant is one still running
 * the code from before this check, open since the deploy: it is let through,
 * as it always was, rather than holding every sale it rings.
 */
export async function otherRestaurant(body: PosSaleBody, actorRestaurant: string): Promise<NextResponse | null> {
  if (body.restaurantId === undefined || body.restaurantId === actorRestaurant) return null;
  return await apiError("apiErr.posOtherRestaurant", 409, undefined, { held: true });
}

/**
 * The sale a till already rang under this `pos_ref`, answered as the ticket it
 * made — or null when there is none.
 *
 * A request that timed out and was sent again must get back the sale it rang,
 * never ring a second one: the money is in the drawer once. Only a sale in the
 * cashier's own restaurant, and only once it is settled: an order still
 * waiting for its money is not an acknowledgement, and the device keeps its
 * copy (`held`) until it is.
 */
export async function existingTicket(
  db: ReturnType<typeof createAdminClient>,
  posRef: string,
  restaurantId: string,
  expected?: PosSaleBody,
): Promise<NextResponse | null> {
  const { data, error } = await db.from("orders")
    .select("id, total, paid, status, account_id, charged_at, currency, pay_method, request_scope, customer_accounts(name)")
    .eq("pos_ref", posRef).eq("restaurant_id", restaurantId).maybeSingle();
  if (error) return await apiError("apiErr.orderCreate", 503);
  if (!data) return null;
  if ((typeof expected?.currency === "string" && data.currency !== expected.currency)
    || (expected?.method && expected.method !== "account" && (data.account_id || data.pay_method !== expected.method))) {
    return await apiError("apiErr.posMismatch", 409, undefined, { held: true });
  }
  // A sale rung before the request was saved with it has no scope; it is
  // matched on its account, as it always was, so its unchanged retry replays.
  if (expected?.method === "account" && (data.account_id !== expected.accountId
    || (data.request_scope !== null && data.request_scope !== orderRequestScope("pos-account", expected)))) {
    return await apiError("apiErr.retryConflict", 409);
  }
  const approved = data.account_id && data.charged_at && data.status !== "pending_payment";
  if (data.status === "pending_payment" || (!data.paid && !approved)) {
    return await apiError("apiErr.posUnsettled", 409, undefined, { held: true });
  }
  return NextResponse.json({
    orderId: data.id, code: orderCode(data.id as string), total: Number(data.total),
    settled: true, repeat: true, currency: data.currency, method: data.pay_method,
    handedOver: data.status === "completed",
    ...(approved ? { onAccount: { name: (data.customer_accounts as unknown as { name: string } | null)?.name } } : {}),
  });
}
