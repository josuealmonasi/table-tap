import { NextRequest, NextResponse } from "next/server";
import { getPlatformAdmin } from "@/lib/admin";
import { apiError } from "@/lib/api-error";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

// Platform history has no browser policy. Page by both time and id so equal
// timestamps and more than a thousand events never hide an action.
export async function GET(req: NextRequest) {
  if (!await getPlatformAdmin()) return await apiError("apiErr.forbidden", 403);
  const cursor = req.nextUrl.searchParams.get("before");
  const [time, id, extra] = cursor?.split(",") ?? [];
  if (cursor !== null && (!TIME.test(time ?? "") || !Number.isFinite(Date.parse(time)) || !UUID.test(id ?? "") || extra !== undefined)) {
    return await apiError("apiErr.invalidRequest", 400);
  }
  let query = createAdminClient().from("platform_admin_audit").select("*")
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(101);
  if (cursor) query = query.or(`created_at.lt.${time},and(created_at.eq.${time},id.lt.${id})`);
  const { data, error } = await query;
  if (error) return await apiError("apiErr.adminAuditUnavailable", 503);
  const entries = (data ?? []).slice(0, 100);
  const last = entries.at(-1);
  return NextResponse.json({ entries, nextCursor: (data?.length ?? 0) > 100 && last ? `${last.created_at},${last.id}` : null }, {
    headers: { "Cache-Control": "no-store" },
  });
}
