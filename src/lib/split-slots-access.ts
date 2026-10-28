import type { NextRequest } from "next/server";
import { actingStaff } from "@/lib/api-guard";
import { tableMember } from "@/lib/table-membership";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SlotSplit, SplitScope } from "@/lib/split-slots";

/** Resolve a trusted identity before using the service key. Body actor ids prove nothing. */
export async function splitActor(req: NextRequest, scope: SplitScope) {
  const staff = await actingStaff();
  if (staff) return staff.restaurantId === scope.restaurantId && staff.role !== "kitchen"
    ? { actor: staff.email, memberId: null, staff: true } : null;
  const member = await tableMember(req, scope.restaurantId, scope.tableId, scope.sessionId, true);
  return member ? { actor: member.id, memberId: member.id, staff: false } : null;
}

export async function readSlotSplit(scope: SplitScope, splitId: string): Promise<SlotSplit | null> {
  const db = createAdminClient();
  const { data: sitting, error: sittingError } = await db.from("table_sessions").select("id")
    .eq("id", scope.sessionId).eq("restaurant_id", scope.restaurantId).eq("table_id", scope.tableId).maybeSingle();
  if (sittingError) throw new Error("Could not read the split sitting");
  if (!sitting) return null;
  const { data, error } = await db.from("bill_splits").select("*")
    .eq("id", splitId).eq("restaurant_id", scope.restaurantId).eq("session_id", scope.sessionId)
    .eq("model_version", 2).maybeSingle();
  if (error) throw new Error("Could not read the split");
  return data as SlotSplit | null;
}
