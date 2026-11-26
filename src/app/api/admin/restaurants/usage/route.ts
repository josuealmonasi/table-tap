import { NextRequest, NextResponse } from "next/server";
import { getPlatformAdmin } from "@/lib/admin";
import { apiError } from "@/lib/api-error";
import { auditedAdminRead } from "@/lib/admin-read-audit";
import { readAdminUsage } from "@/lib/admin-usage-read";

export const runtime = "nodejs";

// GET /api/admin/restaurants/usage?id= — a restaurant's sales figures. Audited
// before the read (restaurant.view, view=usage); no audit, no figures.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const admin = await getPlatformAdmin();
  if (!admin) return apiError("apiErr.forbidden", 403);
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return apiError("apiErr.invalidRequest", 400);
  }
  try {
    const answer = await auditedAdminRead(admin, id, "usage", () => readAdminUsage(id));
    if (!answer.audited) return apiError("apiErr.adminAuditUnavailable", 503);
    if (!answer.value) return apiError("apiErr.invalidRequest", 404);
    return NextResponse.json(answer.value);
  } catch {
    return apiError("apiErr.invalidRequest", 500);
  }
}
