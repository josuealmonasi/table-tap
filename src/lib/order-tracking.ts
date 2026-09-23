import { createAdminClient } from "@/lib/supabase/admin";
import type { Order } from "@/lib/types";

/**
 * The subset of an order the customer's tracker needs. Deliberately excludes
 * payment references (stripe_*), the internal note, and anything else the
 * customer-facing screen doesn't render.
 */
export type TrackedOrder = Pick<
  Order,
  | "id"
  | "restaurant_id"
  | "table_id"
  | "table_label"
  | "status"
  | "items"
  | "total"
  | "currency"
  // So a bill paid at the end is not called "Total paid".
  | "paid"
  // Their own name, when they gave one at the counter. They should be able to
  // check what the cashier is about to call out.
  | "customer_name"
  // The floor cancelled this table's debt. For the diner that is the end of
  // it, whatever stage the kitchen last left it at — and the phone has to be
  // told, or it goes on offering to follow an order nobody is cooking.
  | "written_off"
>;

const TRACKER_COLUMNS =
  "id, restaurant_id, table_id, table_label, status, items, total, currency, paid, customer_name, written_off";

// UUIDs only — avoids sending malformed ids to Postgres' uuid column.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fetches a single order by its (unguessable) id using the SECRET key —
 * server-side only. The customer proves ownership by knowing the id; the
 * publishable key has no read access to orders at all. There's no way to
 * enumerate: a specific id is required and only that one row is returned.
 */
export async function fetchTrackedOrder(orderId: string): Promise<TrackedOrder | null> {
  if (!UUID_RE.test(orderId)) return null;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("orders")
    .select(TRACKER_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();
  // A read that failed is not an order that does not exist. It came back as
  // null, and the tracker page answered a diner who had just ordered with
  // "not found". Thrown: the page offers a retry and says nothing was lost.
  if (error) throw new Error(`Could not read the order: ${error.message}`);
  return (data as TrackedOrder | null) ?? null;
}
