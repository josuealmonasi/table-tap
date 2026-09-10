import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { fetchCounterBill, fetchTableBill } from "@/lib/bill-data";
import { tableOutstanding } from "@/lib/table-outstanding";
import { unpaidOrders } from "@/lib/table-bill";
import { foodOrdered } from "@/lib/table-balance";

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
 *
 * `outstanding` comes back with it: what the table ordered, what has already
 * been collected in parts, and what is left. A bill settled a hundred pesos at
 * a time no longer adds up to the sum of its orders, and a dialog that worked
 * that sum out for itself would ask for money already in the till.
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
    if (tableId) {
      const [orders, outstanding] = await Promise.all([
        fetchTableBill(actor.restaurantId, tableId, "staff"),
        tableOutstanding(actor.restaurantId, tableId),
      ]);
      // The rows themselves are already in `orders`, in the shape the bill
      // screen wants; only the arithmetic goes back a second time.
      return NextResponse.json({
        orders,
        outstanding: {
          ordered: outstanding.ordered,
          collected: outstanding.collected,
          tips: outstanding.tips,
          owed: outstanding.owed,
        },
      });
    }

    // A counter order is one order, collected on its own: nothing can have been
    // taken against it in parts, so what is owed is simply what it came to.
    const orders = await fetchCounterBill(actor.restaurantId, orderId!);
    const ordered = foodOrdered(unpaidOrders(orders));
    return NextResponse.json({
      orders,
      outstanding: { ordered, collected: 0, tips: 0, owed: ordered },
    });
  } catch {
    return await apiError("apiErr.ordersLoad", 500);
  }
}
