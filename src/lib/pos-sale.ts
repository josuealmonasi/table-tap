import { apiError } from "@/lib/api-error";
import { NextResponse } from "next/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import { orderCode, type OrderLineItem } from "@/lib/types";

/** What the till sends when a cashier rings a sale. */
export interface PosSaleBody {
  posRef?: string;
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
): Promise<NextResponse | null> {
  const { data, error } = await db.from("orders")
    .select("id, total, paid, status, account_id, charged_at, customer_accounts(name)")
    .eq("pos_ref", posRef).eq("restaurant_id", restaurantId).maybeSingle();
  if (error) return await apiError("apiErr.orderCreate", 503);
  if (!data) return null;
  const approved = data.account_id && data.charged_at && data.status !== "pending_payment";
  if (data.status === "pending_payment" || (!data.paid && !approved)) {
    return await apiError("apiErr.posUnsettled", 409, undefined, { held: true });
  }
  return NextResponse.json({
    orderId: data.id, code: orderCode(data.id as string), total: Number(data.total),
    settled: true, repeat: true,
    handedOver: data.status === "completed",
    ...(approved ? { onAccount: { name: (data.customer_accounts as unknown as { name: string } | null)?.name } } : {}),
  });
}
