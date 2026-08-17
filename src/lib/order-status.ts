import type { OrderStatus } from "@/lib/types";

/**
 * How each stage is named and coloured on the board.
 *
 * Shared, because two screens showing the same order must not disagree about
 * what stage it is at — the detail dialog was deriving its own key from the
 * status name and inventing one the dictionary had never heard of.
 */
export const STATUS_META: Record<string, { labelKey: string; color: string }> = {
  received: { labelKey: "orders.statusNew", color: "var(--tt-gold)" },
  preparing: { labelKey: "orders.statusPreparing", color: "var(--tt-accent)" },
  ready: { labelKey: "orders.statusReady", color: "var(--tt-success)" },
  completed: { labelKey: "orders.statusCompleted", color: "var(--tt-muted)" },
  cancelled: { labelKey: "orders.statusCancelled", color: "var(--tt-muted)" },
};

export function statusMeta(status: OrderStatus): { labelKey: string; color: string } {
  return STATUS_META[status] ?? STATUS_META.completed;
}
