import { createAdminClient } from "@/lib/supabase/admin";
import type { Order } from "@/lib/types";

/**
 * The subset of an order the customer's tracker needs. Deliberately excludes
 * payment references (stripe_*), the internal note, and anything else the
 * customer-facing screen doesn't render.
 */
export type TrackedOrder = Pick<Order, "id" | "table_label" | "status" | "items" | "total" | "currency">;

const TRACKER_COLUMNS = "id, table_label, status, items, total, currency";

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
  const { data } = await admin.from("orders").select(TRACKER_COLUMNS).eq("id", orderId).single();
  return (data as TrackedOrder | null) ?? null;
}
