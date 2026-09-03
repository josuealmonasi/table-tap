import { createAdminClient } from "@/lib/supabase/admin";
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
 * back if the payment never happens — see `releaseAbandonedOrder` in the Stripe
 * webhook, which is the other half of this. Doing it the other way round (count
 * down only once paid) means two diners can both be sold the last portion while
 * they are each staring at a Stripe page.
 *
 * Everything here runs with the secret key: `reserve_stock` and `release_stock`
 * are granted to `service_role` alone, so no browser can move a count.
 */

/** Nothing tracked in this cart — the common case, and worth not paying for. */
const NOTHING_TO_DO: ReserveResult = { ok: true, short: [], low: [] };

/**
 * Take what the order needs, all or nothing.
 *
 * Returns `ok: false` with the shortfalls when the kitchen cannot fill it, so
 * the caller can tell the diner how many there really are.
 */
export async function reserveStock(
  restaurantId: string,
  lines: OrderLineItem[],
  threshold: number,
): Promise<ReserveResult> {
  const demand = stockDemand(lines);
  if (demand.length === 0) return NOTHING_TO_DO;

  const { data, error } = await createAdminClient().rpc("reserve_stock", {
    p_restaurant: restaurantId,
    p_demand: toDemandPayload(demand),
    p_threshold: threshold,
  });

  // A reservation that errored is not a reservation. Refusing here sends the
  // diner back to the cart, which is recoverable; selling food that is not
  // there is not.
  if (error) return { ok: false, short: [], low: [] };
  return parseReserveResult(data);
}

/**
 * Give an order's stock back.
 *
 * Safe to call for an order that never reserved anything: untracked dishes are
 * skipped inside the function, and an empty cart never reaches it.
 */
export async function releaseStock(
  restaurantId: string,
  lines: OrderLineItem[],
): Promise<void> {
  const demand = stockDemand(lines);
  if (demand.length === 0) return;

  await createAdminClient().rpc("release_stock", {
    p_restaurant: restaurantId,
    p_demand: toDemandPayload(demand),
  });
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
