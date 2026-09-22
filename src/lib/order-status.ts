import type { OrderStatus } from "@/lib/types";

/**
 * How each stage is named and coloured on the board.
 *
 * Shared, because two screens showing the same order must not disagree about
 * what stage it is at — the detail dialog was deriving its own key from the
 * status name and inventing one the dictionary had never heard of.
 */
//
// Keyed by `OrderStatus` itself, so a status without a name is a compile error.
// It used to be `Record<string, …>` with a fallback to `completed`, which meant
// `pending_payment` — a card checkout still waiting on Stripe, or abandoned
// there — had no entry and would have been painted grey and called
// "Completado". No screen shows one today: the board filters them at the query
// and in the realtime handler, and history asks only for closed orders. The
// next screen that shows them would have lied, and nothing would have said so.
export const STATUS_META: Record<OrderStatus, { labelKey: string; color: string }> = {
  pending_payment: { labelKey: "orders.statusAwaitingPayment", color: "var(--tt-muted)" },
  received: { labelKey: "orders.statusNew", color: "var(--tt-gold)" },
  preparing: { labelKey: "orders.statusPreparing", color: "var(--tt-accent)" },
  ready: { labelKey: "orders.statusReady", color: "var(--tt-success)" },
  completed: { labelKey: "orders.statusCompleted", color: "var(--tt-muted)" },
  cancelled: { labelKey: "orders.statusCancelled", color: "var(--tt-muted)" },
};

export function statusMeta(status: OrderStatus): { labelKey: string; color: string } {
  // Still guarded: a row can arrive over the wire carrying a status this build
  // has never heard of — a migration ahead of a deploy. Better grey than blank.
  return STATUS_META[status] ?? STATUS_META.completed;
}
