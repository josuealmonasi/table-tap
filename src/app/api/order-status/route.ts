import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { clientIp, forTheRoom, isRateLimited } from "@/lib/rate-limit";
import { ORDER_HEARTBEAT_MS, ORDERS_FOLLOWED, TRACKER_POLL_MS, perMinute } from "@/lib/poll";
import { fetchTrackedOrder } from "@/lib/order-tracking";

export const dynamic = "force-dynamic";

// GET /api/order-status?id=<orderId> — the customer's tracker polls this for
// live status. Reads a single order by its unguessable id via the secret key
// (server-side); returns only the customer-facing fields.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return await apiError("apiErr.missingId", 400);

  // The unguessable id is the trust boundary; this is a ceiling on floods.
  // It is keyed by address, and one address is a whole room on the house
  // Wi-Fi, so it is sized for the room: every open tracker, and the menu
  // asking after each order it follows. It was 120, "far above what a real
  // diner's phone asks for", which was true of one phone.
  const perPhone = perMinute(TRACKER_POLL_MS) + ORDERS_FOLLOWED * perMinute(ORDER_HEARTBEAT_MS);
  if (await isRateLimited(`order-status:${clientIp(req)}`, forTheRoom(perPhone), 60)) {
    return await apiError("apiErr.tooManyRequests", 429);
  }

  const order = await fetchTrackedOrder(id);
  if (!order) return await apiError("apiErr.notFound", 404);

  return NextResponse.json(order);
}
