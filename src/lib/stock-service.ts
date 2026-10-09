import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/plan";
import { getPlan } from "@/lib/plan-server";
import {
  parseReserveResult,
  stockDemand,
  toDemandPayload,
  type ReserveResult,
  type StockWarning,
} from "@/lib/stock";
import type { OrderLineItem } from "@/lib/types";

/**
 * Taking and giving back stock, the same way coupons are claimed and released.
 *
 * A checkout reserves what it needs before the money is asked for, and hands it
 * back if the payment never happens — see `abandonCheckout` in the Stripe
 * webhook, which is the other half of this. Doing it the other way round (count
 * down only once paid) means two diners can both be sold the last portion while
 * they are each staring at a Stripe page.
 *
 * Everything here runs with the secret key: `reserve_stock` and `release_stock_reservation`
 * are granted to `service_role` alone, so no browser can move a count.
 */

export interface StockReservation extends ReserveResult {
  reservationId: string | null;
}

/** The plan decides whether to take stock; the reservation decides what returns. */
export async function reserveStock(
  restaurantId: string,
  lines: OrderLineItem[],
  threshold: number,
): Promise<StockReservation> {
  const demand = stockDemand(lines);
  const plan = demand.length ? await getPlan(restaurantId) : null;
  if (!demand.length || !plan || !can(plan.limits, "inventory")) {
    return { ok: true, short: [], low: [], reservationId: null };
  }
  const reservationId = randomUUID();
  const { data, error } = await createAdminClient().rpc("reserve_stock", {
    p_restaurant: restaurantId,
    p_demand: toDemandPayload(demand),
    p_threshold: threshold,
    p_reservation: reservationId,
  });
  if (error) throw new Error(`Stock reservation ${reservationId} failed: ${error.message}`);
  const result = parseReserveResult(data);
  return { ...result, reservationId: result.ok ? reservationId : null };
}

/**
 * Return only what this reservation took, once. Cancellation and deletion do
 * this inside the order's transaction; this call is for a failed order insert.
 * A failed return throws and leaves the durable record available for recovery.
 */
export async function releaseStock(
  restaurantId: string,
  reservationId: string | null,
): Promise<void> {
  if (!reservationId) return;
  const { error } = await createAdminClient().rpc("release_stock_reservation", {
    p_restaurant: restaurantId,
    p_reservation: reservationId,
  });
  if (error) throw new Error(`Stock release ${reservationId} failed: ${error.message}`);
}

/**
 * Put a warning in the bell for the people who can act on it.
 *
 * The sentence is not stored — only what happened and to which dish. The
 * dashboard is read in two languages and a restaurant can switch between them
 * at any moment, so the wording is chosen when the notification is read rather
 * than when it is raised.
 *
 * Failing to write one must never fail the order: the diner has paid, the
 * kitchen needs the ticket, and a missing bell entry is not worth losing that
 * over.
 */
export async function raiseStockNotifications(
  restaurantId: string,
  warnings: StockWarning[],
): Promise<void> {
  if (warnings.length === 0) return;

  try {
    await createAdminClient()
      .from("notifications")
      .insert(
        warnings.map(w => ({
          restaurant_id: restaurantId,
          kind: w.kind,
          data: { itemId: w.itemId, name: w.name, stock: w.stock },
        })),
      );
  } catch {
    // Deliberately swallowed — see above.
  }
}
