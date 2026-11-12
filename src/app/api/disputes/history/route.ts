import { NextRequest, NextResponse } from "next/server";
import { actingManager } from "@/lib/api-guard";
import { apiError } from "@/lib/api-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { readDisputeHistory } from "@/lib/disputes/read";

export async function GET(request: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const ids = [...new Set(request.nextUrl.searchParams.getAll("order"))];
  if (ids.length > 20 || ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) return await apiError("apiErr.invalidRequest", 400);
  try {
    return NextResponse.json(await readDisputeHistory(createAdminClient(), actor.restaurantId, ids), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("dispute-history-read-failed", error);
    return await apiError("disputes.unavailable", 500);
  }
}
