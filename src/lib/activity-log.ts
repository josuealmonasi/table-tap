import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { withOrderCurrency } from "@/lib/log-money";

/**
 * The restaurant's record of who did what.
 *
 * Everything an owner might have to answer for later goes through here: money
 * that moved without a card (cash, a write-off, a promotion applied at the
 * table), an order cancelled or refunded, a login created or removed, a
 * setting that changes what customers are charged. If an action would be worth
 * asking about a week later, it belongs in this list.
 *
 * Writes are best-effort on purpose. A failed log line must never take down
 * the action it was recording — a waiter's till doesn't stop working because
 * the audit trail is having a bad minute.
 */

/** What kind of thing was acted on. Used to group and filter the list. */
export type LogEntity =
  | "staff"
  | "order"
  | "bill"
  | "discount"
  | "coupon"
  | "promotion"
  | "settings"
  | "menu"
  /** A diner's visit card: stamped, or its reward spent. */
  | "loyalty"
  /** A customer account: opened, charged, collected, its ceiling moved. */
  | "account"
  /** The cash drawer: its opening balance set, money taken out of it. */
  | "cash"
  /** Ingredients, recipes and the fee rate the margins are worked out with. */
  | "costs"
  /** The restaurant's own card terminal: a day's deposit marked as arrived. */
  | "terminal";

/** What happened to it. Deliberately plain words: this list is read by owners. */
export type LogAction =
  | "created"
  | "updated"
  | "deleted"
  | "paid"
  /** Part of a bill, when the rest is still owed. */
  | "collected"
  | "written_off"
  | "discounted"
  | "requested"
  | "approved"
  | "rejected"
  | "cancelled"
  | "refunded"
  /** Stripe failed a refund it first reported as succeeded. */
  | "refund_failed"
  /** A manager approved a receipt already collected while offline. */
  | "offline_recovered"
  | "paused"
  | "resumed"
  | "stamped"
  | "redeemed"
  /** Put on a customer's account: delivered, not yet paid. */
  | "charged"
  | "closed"
  /** A shift at the cash drawer started. */
  | "opened";

export interface LogEvent {
  restaurantId: string;
  /** Stable identity of the saved operation, so retries cannot append it twice. */
  operationKey?: string;
  /** Who did it, by email — the only identity we have for staff. */
  actor: string;
  entity: LogEntity;
  action: LogAction;
  /** The specifics, already in words: "Table 4 · MX$120.00", "IVA 16% → 8%". */
  detail?: string | null;
  /** Orders behind a monetary entry, so reports can verify its currency. */
  orderIds?: string[];
  /** Kept for the staff rows, which the log has always carried. */
  targetEmail?: string | null;
  targetRole?: string | null;
}

export async function logEvent(event: LogEvent): Promise<void> {
  try {
    const row = {
      restaurant_id: event.restaurantId,
      actor_email: event.actor,
      entity: event.entity,
      action: event.action,
      detail: event.orderIds ? await withOrderCurrency(event.detail, event.restaurantId, event.orderIds) : event.detail ?? null,
      target_email: event.targetEmail ?? null,
      target_role: event.targetRole ?? null,
    };
    const logs = createAdminClient().from("user_logs");
    // The primary key arbitrates concurrent retries. Ignore rather than update:
    // another cashier repeating the request must not rewrite who did it first.
    const { error } = event.operationKey
      ? await logs.upsert({ ...row, id: activityId(event) }, { onConflict: "id", ignoreDuplicates: true })
      : await logs.insert(row);
    if (error) throw new Error(`Could not write activity: ${error.message}`);
  } catch (err) {
    console.error("activity log:", err);
  }
}

/** Namespace each identity by restaurant and action without adding a schema key. */
function activityId(event: LogEvent): string {
  const bytes = createHash("sha256").update(JSON.stringify([
    "TableTap activity v1", event.restaurantId, event.entity, event.action, event.operationKey,
  ])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
