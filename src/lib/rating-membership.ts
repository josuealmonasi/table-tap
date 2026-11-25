import type { NextRequest } from "next/server";
import { tableMember } from "@/lib/table-membership";

interface RatedOrder {
  table_id?: string | null;
  table_label?: string | null;
  session_id?: string | null;
  diner?: string | null;
}

/**
 * Counter order links remain capabilities; table ratings belong to their member phone.
 *
 * Deleting a table clears `table_id` and, with its sittings, `session_id`. The
 * label copied onto the order at insert is never cleared, so it keeps a former
 * table order off the bearer path: with no sitting left, nobody can prove
 * membership, and the order is refused rather than rated by a copied link.
 */
export async function memberRatingOrders<T extends RatedOrder>(req: NextRequest, restaurantId: string, orders: T[]): Promise<T[]> {
  const allowed = await Promise.all(orders.map(async order => {
    if (!order.table_id && !order.session_id && !order.table_label) return order;
    if (!order.table_id || !order.session_id) return null;
    const member = await tableMember(req, restaurantId, order.table_id, order.session_id, true);
    return member?.id === order.diner ? order : null;
  }));
  return orders.filter((_, index) => allowed[index] !== null);
}
