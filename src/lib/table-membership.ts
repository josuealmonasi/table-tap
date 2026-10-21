import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { memberHash } from "@/lib/table-member-cookie";
import { OPEN_BILL_HOURS } from "@/lib/table-bill";

export interface TableMember {
  id: string;
  sessionId: string;
  restaurantId: string;
  tableId: string;
  closed: boolean;
  /** Private order links from before phone credentials existed: payment only. */
  legacyOrderIds?: string[];
}

export interface JoinState {
  status: "empty" | "pending" | "approved" | "rejected";
  sessionId: string | null;
  diner: string | null;
}

/** Only ordering opens a sitting; merely reading the menu never occupies it. */
export async function requestTableMember(
  restaurantId: string, tableId: string, hash: string, open = false,
): Promise<JoinState> {
  const { data, error } = await createAdminClient().rpc("request_table_member", {
    p_restaurant: restaurantId, p_table: tableId, p_hash: hash, p_open: open,
  });
  if (error || !data) throw new Error("Could not join the table");
  return data as JoinState;
}

/**
 * A table id and a self-chosen diner id prove nothing. Only this cookie's
 * approved row grants access, and only to the sitting named on that row.
 * Closed sittings remain readable for settling one's own food, never joining
 * the next party. New orders and approvals require the live sitting instead.
 */
export async function tableMember(
  req: NextRequest, restaurantId: string, tableId: string,
  sessionId?: string | null, historical = false,
): Promise<TableMember | null> {
  const hash = memberHash(req);
  if (!hash) return null;
  const db = createAdminClient();
  let query = db.from("table_sessions").select("id, closed_at, opened_at")
    .eq("restaurant_id", restaurantId).eq("table_id", tableId);
  query = sessionId ? query.eq("id", sessionId) : query.is("closed_at", null);
  const { data: session, error } = await query.maybeSingle();
  if (error) throw new Error("Could not check the sitting");
  if (!session || (session.closed_at && !historical)) return null;
  if (!historical && Date.parse(session.opened_at) < Date.now() - OPEN_BILL_HOURS * 3600000) return null;
  const { data: member, error: memberError } = await db.from("table_session_members")
    .select("id, status").eq("session_id", session.id).eq("token_hash", hash).maybeSingle();
  if (memberError) throw new Error("Could not check table membership");
  if (member?.status !== "approved") return null;
  return { id: member.id, sessionId: session.id, restaurantId, tableId, closed: Boolean(session.closed_at) };
}

/**
 * The table's sitting, if a party is eating at it now. Asked by the table page
 * and the visit card route alike, so the two cannot disagree about whether a
 * phone is arriving at an empty table or at somebody else's meal.
 */
export async function openSittingAt(restaurantId: string, tableId: string): Promise<string | null> {
  const { data, error } = await createAdminClient().from("table_sessions").select("id")
    .eq("restaurant_id", restaurantId).eq("table_id", tableId).is("closed_at", null)
    .gte("opened_at", new Date(Date.now() - OPEN_BILL_HOURS * 3600000).toISOString())
    .limit(1).maybeSingle();
  if (error) throw new Error("Could not check the table");
  return data?.id ?? null;
}
