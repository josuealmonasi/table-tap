import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { fetchTableBill } from "@/lib/bill-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/table-bill?tableId=<id> — what a table owes, for the floor.
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
  if (!tableId) return await apiError("apiErr.missingId", 400);

  try {
    const orders = await fetchTableBill(actor.restaurantId, tableId, "staff");
    return NextResponse.json({ orders });
  } catch {
    return await apiError("apiErr.ordersLoad", 500);
  }
}
