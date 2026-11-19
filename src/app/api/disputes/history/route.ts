import { NextRequest, NextResponse } from "next/server";
import { actingManager } from "@/lib/api-guard";
import { apiError } from "@/lib/api-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { readDisputeHistory } from "@/lib/disputes/read";
import { isRateLimited } from "@/lib/rate-limit";

/** History reads per manager per minute. A page asks once (useDisputeHistory); this is room for revalidation, not for a loop. */
const READS_PER_MINUTE = 30;

export async function GET(request: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const ids = [...new Set(request.nextUrl.searchParams.getAll("order"))];
  if (ids.length > 20 || ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) return await apiError("apiErr.invalidRequest", 400);
  // Every read pages through the restaurant's whole dispute history and checks
  // each case's ownership, whatever was asked for. With no order there is
  // nothing to answer, and repeated reads are capped per manager: small
  // requests must not turn into unbounded work on the shared database
  // (security review 2026-11-17, finding 3).
  if (!ids.length) return NextResponse.json({}, { headers: { "Cache-Control": "no-store" } });
  if (await isRateLimited(`dispute-history:${actor.restaurantId}:${actor.email}`, READS_PER_MINUTE, 60)) {
    return await apiError("apiErr.tooManyRequests", 429);
  }
  try {
    return NextResponse.json(await readDisputeHistory(createAdminClient(), actor.restaurantId, ids), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("dispute-history-read-failed", error);
    return await apiError("disputes.unavailable", 500);
  }
}
