import { isRoomLimited } from "@/lib/rate-limit";
import { apiError } from "@/lib/api-error";
import { type NextRequest, type NextResponse } from "next/server";
import { controlSplit } from "@/lib/split-slots-control";

export const runtime = "nodejs";
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (await isRoomLimited(req, "split-resize", 20)) return await apiError("apiErr.tooManyAttempts", 429);
  return await controlSplit(req, "resize");
}
