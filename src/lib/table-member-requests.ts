import { createAdminClient } from "@/lib/supabase/admin";

export interface PendingPhone {
  id: string;
  tableId: string;
  tableLabel: string;
  createdAt: string;
}

interface PendingRow {
  id: string;
  created_at: string;
  table_sessions: { table_id: string; restaurant_tables: { label: string } | null };
}

/** No credential or other bill details ever leave this staff/member projection. */
export async function pendingPhones(restaurantId: string, sessionId?: string): Promise<PendingPhone[]> {
  let query = createAdminClient().from("table_session_members")
    .select("id, created_at, table_sessions!inner(id, restaurant_id, table_id, closed_at, opened_at, restaurant_tables(label))")
    .eq("status", "pending").eq("table_sessions.restaurant_id", restaurantId)
    .is("table_sessions.closed_at", null)
    .gte("table_sessions.opened_at", new Date(Date.now() - 8 * 3600000).toISOString())
    .order("created_at");
  if (sessionId) query = query.eq("session_id", sessionId);
  const { data, error } = await query.returns<PendingRow[]>();
  if (error) throw new Error("Could not read pending phones");
  return (data ?? []).map(row => ({
    id: row.id, createdAt: row.created_at, tableId: row.table_sessions.table_id,
    tableLabel: row.table_sessions.restaurant_tables?.label ?? "",
  }));
}
