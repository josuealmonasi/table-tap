import type { OrderStatus } from "@/lib/types";

/**
 * How an order moves across the board.
 *
 * The live statuses are a straight line — a ticket is taken, cooked, then
 * waiting to go out — so the board is that line as columns and the buttons
 * walk it forwards. Everything here is derived from LIVE_FLOW: adding a stage
 * means adding it once, and the columns, the forward button and the move-back
 * menu all follow.
 *
 * `completed` and `cancelled` are deliberately not columns. They accumulate all
 * day and would bury the tickets that still need doing; History already holds
 * them.
 */
export const LIVE_FLOW: OrderStatus[] = ["received", "preparing", "ready"];

export interface BoardColumn {
  status: OrderStatus;
  /** i18n key for the column heading. */
  labelKey: string;
  /** Token for the column's accent, matching the card's left edge. */
  color: string;
}

export const BOARD_COLUMNS: BoardColumn[] = [
  { status: "received", labelKey: "orders.colNew", color: "var(--tt-gold)" },
  { status: "preparing", labelKey: "orders.colPreparing", color: "var(--tt-accent)" },
  { status: "ready", labelKey: "orders.colReady", color: "var(--tt-success)" },
];

/** Where this status sits in the line, or -1 when it isn't a live stage. */
export function flowIndex(status: OrderStatus): number {
  return LIVE_FLOW.indexOf(status);
}

/**
 * The stages an order could be sent *back* to.
 *
 * Only earlier ones: moving forward is what the card's main button is for, and
 * offering both directions in the same menu makes the obvious action ambiguous.
 * Returned nearest-first, so the common "undo one step" is the top item.
 */
export function backwardOptions(status: OrderStatus): OrderStatus[] {
  const i = flowIndex(status);
  if (i <= 0) return [];
  return LIVE_FLOW.slice(0, i).reverse();
}

/**
 * Orders for one column, oldest first.
 *
 * A kitchen works the queue front to back, so the ticket waiting longest sits
 * at the top and a new one joins the bottom.
 */
export function columnOrders<T extends { status: OrderStatus; created_at: string }>(
  orders: T[],
  status: OrderStatus,
): T[] {
  return orders
    .filter(o => o.status === status)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}
