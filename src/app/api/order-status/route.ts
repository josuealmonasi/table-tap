import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { fetchTrackedOrder } from "@/lib/order-tracking";

export const dynamic = "force-dynamic";

// GET /api/order-status?id=<orderId> — the customer's tracker polls this for
// live status. Reads a single order by its unguessable id via the secret key
// (server-side); returns only the customer-facing fields.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return await apiError("apiErr.missingId", 400);

  const order = await fetchTrackedOrder(id);
  if (!order) return await apiError("apiErr.notFound", 404);

  return NextResponse.json(order);
}
