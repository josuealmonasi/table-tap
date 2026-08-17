import { createAdminClient } from "@/lib/supabase/admin";

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
  | "menu";

/** What happened to it. Deliberately plain words: this list is read by owners. */
export type LogAction =
  | "created"
  | "updated"
  | "deleted"
  | "paid"
  | "written_off"
  | "discounted"
  | "requested"
  | "approved"
  | "rejected"
  | "cancelled"
  | "refunded"
  | "paused"
  | "resumed";

export interface LogEvent {
  restaurantId: string;
  /** Who did it, by email — the only identity we have for staff. */
  actor: string;
  entity: LogEntity;
  action: LogAction;
  /** The specifics, already in words: "Table 4 · MX$120.00", "IVA 16% → 8%". */
  detail?: string | null;
  /** Kept for the staff rows, which the log has always carried. */
  targetEmail?: string | null;
  targetRole?: string | null;
}

export async function logEvent(event: LogEvent): Promise<void> {
  try {
    await createAdminClient().from("user_logs").insert({
      restaurant_id: event.restaurantId,
      actor_email: event.actor,
      entity: event.entity,
      action: event.action,
      detail: event.detail ?? null,
      target_email: event.targetEmail ?? null,
      target_role: event.targetRole ?? null,
    });
  } catch (err) {
    console.error("activity log:", err);
  }
}
