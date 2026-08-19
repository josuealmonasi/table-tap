import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { fetchTrackedOrder } from "@/lib/order-tracking";

export const dynamic = "force-dynamic";

// GET /api/order-status?id=<orderId> — the customer's tracker polls this for
// live status. Reads a single order by its unguessable id via the secret key
// (server-side); returns only the customer-facing fields.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return await apiError("apiErr.missingId", 400);

  // The unguessable id is the trust boundary, but this was the one public
  // route with no ceiling at all — every other one has had a limit for
  // months. The tracker polls every five seconds, so this is far above what
  // a real diner's phone asks for.
  if (await isRateLimited(`order-status:${clientIp(req)}`, 120, 60)) {
    return await apiError("apiErr.tooManyRequests", 429);
  }

  const order = await fetchTrackedOrder(id);
  if (!order) return await apiError("apiErr.notFound", 404);

  return NextResponse.json(order);
}
