import { NextRequest, NextResponse } from "next/server";
import { getPlatformAdmin } from "@/lib/admin";
import { apiError } from "@/lib/api-error";
import { readAdminUsage } from "@/lib/admin-usage-read";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!await getPlatformAdmin()) return apiError("apiErr.forbidden", 403);
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return apiError("apiErr.invalidRequest", 400);
  }
  try {
    const data = await readAdminUsage(id);
    if (!data) return apiError("apiErr.invalidRequest", 404);
    return NextResponse.json(data);
  } catch {
    return apiError("apiErr.invalidRequest", 500);
  }
}
