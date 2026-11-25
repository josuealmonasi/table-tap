import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError } from "@/lib/api-error";
import { isRateLimited } from "@/lib/rate-limit";

/**
 * A waiter's ask for a manager (a discount or a write-off) can be repeated
 * without end: each tap inserted another pending row into the managers' queue
 * (security sweep 2026-11-24). One pending request per table, and a
 * per-person ceiling. Answers the response to send, or null to go ahead.
 */
export async function repeatedStaffRequest(
  db: SupabaseClient, table: "discount_requests" | "write_off_requests",
  restaurantId: string, tableId: string | null, actorEmail: string,
): Promise<NextResponse | null> {
  if (await staffWriteLimited(actorEmail, "staff-request")) return await apiError("apiErr.tooManyWait", 429);
  if (!tableId) return null;
  const { data, error } = await db.from(table).select("amount")
    .eq("restaurant_id", restaurantId).eq("table_id", tableId).eq("status", "pending").limit(1);
  if (error) return await apiError("apiErr.generic", 503);
  return data?.length ? NextResponse.json({ pending: true, amount: Number(data[0].amount), duplicate: true }) : null;
}

/** A staff member's write ceiling: 30 a minute per person, per kind of write. */
export async function staffWriteLimited(actorEmail: string, kind: string): Promise<boolean> {
  return isRateLimited(`${kind}:${actorEmail}`, 30, 60);
}
