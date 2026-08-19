import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { fetchTableBill } from "@/lib/bill-data";

export const dynamic = "force-dynamic";

// GET /api/bill?restaurantId=<id>&tableId=<id>
//
// What the table still owes. The bill screen polls this while the diners are
// sitting there, so it is throttled: it reads with the secret key, and a table
// id is the only thing standing between a caller and somebody's order history.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const restaurantId = req.nextUrl.searchParams.get("restaurantId");
  const tableId = req.nextUrl.searchParams.get("tableId");
  // Optional: the sitting this phone belongs to, so its own bill stays payable.
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!restaurantId || !tableId) return await apiError("apiErr.missingId", 400);

  if (await isRateLimited(`bill:${clientIp(req)}`, 60, 60)) {
    return await apiError("apiErr.tooManyRequests", 429);
  }

  try {
    const orders = await fetchTableBill(restaurantId, tableId, "diner", sessionId);
    return NextResponse.json({ orders });
  } catch {
    return await apiError("apiErr.ordersLoad", 500);
  }
}
