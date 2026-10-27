import type { BoardOrder } from "@/lib/kitchen-ticket";
import type { OrderStatus } from "@/lib/types";

export function orderChanges() {
  const seen = new Map<string, number>();
  const active = new Map<string, number>();
  const remember = (id: string, at = Date.now()): void => {
    // A delayed HTTP reply must not erase a newer realtime commit time.
    seen.set(id, Math.max(seen.get(id) ?? -Infinity, at));
  };
  return { seen, active, readAt: 0, remember,
    protect: (id: string): ((at?: number) => void) => {
      active.set(id, (active.get(id) ?? 0) + 1);
      remember(id);
      return (at?: number) => {
        const left = (active.get(id) ?? 1) - 1;
        if (left) active.set(id, left); else active.delete(id);
        remember(id, at);
      };
    } };
}

/** A refreshed read repairs missed events without erasing work received during it. */
export function reconcileOrders(previous: BoardOrder[], initial: BoardOrder[], readAt: number,
  queued: { id: string; to: OrderStatus }[], changes: ReturnType<typeof orderChanges>): BoardOrder[] {
  if (readAt < changes.readAt) return previous; // A slower, older refresh cannot undo a newer one.
  changes.readAt = readAt;
  const merged = new Map(initial.map(order => [order.id, order]));
  for (const order of previous) {
    if ((changes.seen.get(order.id) ?? -1) >= readAt || changes.active.has(order.id))
      merged.set(order.id, order);
  }
  // A saved offline path is still the person's visible intent, even if the
  // new read has not received it. Apply every step, leaving the final one.
  const previousById = new Map(previous.map(order => [order.id, order]));
  for (const move of queued) {
    const order = merged.get(move.id) ?? previousById.get(move.id);
    if (order) merged.set(move.id, { ...order, status: move.to });
  }
  for (const [id, at] of changes.seen) {
    if (at < readAt && !changes.active.has(id)) changes.seen.delete(id);
  }
  return [...merged.values()];
}

/** HTTP dates have whole seconds; keep the entire reply second to be conservative. */
export function orderReplyTime(response: Response): number {
  const date = response.headers?.get("date");
  const at = date ? Date.parse(date) : NaN;
  return Number.isFinite(at) ? at + 1000 : Date.now();
}
