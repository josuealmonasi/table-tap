import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { fetchCounterBill, fetchTableBill } from "@/lib/bill-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/table-bill?tableId=<id> — what a table owes, for the floor.
 * GET /api/table-bill?orderId=<id> — what a counter order owes, same thing.
 *
 * The same bill the diner sees, minus the window: staff are the ones who
 * collect the money or write it off, so an older debt has to be visible to
 * them. Reading it through the customer endpoint is what left a waiter
 * looking at a table that owed MX$105 while the settle dialog told them the
 * table owed nothing.
 *
 * Front of house only, and scoped to the caller's own restaurant, so the
 * table id is never enough on its own.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const actor = await actingFrontOfHouse();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const tableId = req.nextUrl.searchParams.get("tableId");
  const orderId = req.nextUrl.searchParams.get("orderId");
  if (!tableId && !orderId) return await apiError("apiErr.missingId", 400);

  try {
    // A general-QR order hangs off no table, so it is asked for by itself. It is
    // scoped to the caller's restaurant just like the table: another business's
    // id finds nothing.
    const orders = tableId
      ? await fetchTableBill(actor.restaurantId, tableId, "staff")
      : await fetchCounterBill(actor.restaurantId, orderId!);
    return NextResponse.json({ orders });
  } catch {
    return await apiError("apiErr.ordersLoad", 500);
  }
}
