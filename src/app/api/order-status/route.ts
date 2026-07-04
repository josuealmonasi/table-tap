import { NextResponse, type NextRequest } from "next/server";
import { fetchTrackedOrder } from "@/lib/order-tracking";

export const dynamic = "force-dynamic";

// GET /api/order-status?id=<orderId> — the customer's tracker polls this for
// live status. Reads a single order by its unguessable id via the secret key
// (server-side); returns only the customer-facing fields.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const order = await fetchTrackedOrder(id);
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(order);
}
