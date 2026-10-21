import { ownBillAccess } from "@/lib/legacy-bill-access";
import { PaymentAttributionRequired } from "@/lib/payment-coverage";
import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { clientKey, forTheRoom, isRateLimited } from "@/lib/rate-limit";
import { BILL_POLL_MS, perMinute } from "@/lib/poll";
import { fetchTableBill } from "@/lib/bill-data";
import { staffOpenedBill } from "@/lib/table-session";
import { tableParty } from "@/lib/table-party-server";
import { splitInProgress } from "@/lib/split-service";

export const dynamic = "force-dynamic";

// GET /api/bill?restaurantId=<id>&tableId=<id>
//
// What the table still owes. The bill screen polls this while the diners are
// sitting there, so it is throttled: it reads with the secret key, and a table
// membership is what stands between a caller and somebody's order history.
//
// `party` comes back with it: how many devices have ordered on this table,
// which is the most ways its bill can be divided. The device tokens themselves
// never leave the server — only the count does.
//
// So does `dividing`: the table has frozen a split. Asked here rather than
// left to /api/split, because that one answers about a SITTING and a phone
// only knows its sitting if it ordered from this device. A phone that scanned
// and did not order saw no split, and was offered the whole bill — which the
// route then refused. The screen and the guard now read the same fact.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const restaurantId = req.nextUrl.searchParams.get("restaurantId");
  const tableId = req.nextUrl.searchParams.get("tableId");
  // Optional: the sitting this phone belongs to, so its own bill stays payable.
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!restaurantId || !tableId) return await apiError("apiErr.missingId", 400);

  // Polled while the bill is open, by every phone behind the room's address.
  if (await isRateLimited(`bill:${clientKey(req)}`, forTheRoom(perMinute(BILL_POLL_MS)), 60)) {
    return await apiError("apiErr.tooManyRequests", 429);
  }

  try {
    const member = await ownBillAccess(req, restaurantId, tableId, sessionId, (req.nextUrl.searchParams.get("own") ?? "").split(","));
    if (!member) return await apiError("apiErr.tableJoin", 403);
    // `staffBill` is what the sheet needs to stop offering a card: a waiter
    // opened this bill and is settling it in person. The routes that charge
    // refuse it as well — this only keeps the screen from promising something
    // the system will turn down.
    const [orders, staffBill, party, dividing] = await Promise.all([
      fetchTableBill(restaurantId, tableId, "diner", member.sessionId, member),
      staffOpenedBill(restaurantId, tableId, member.sessionId),
      member.legacyOrderIds ? Promise.resolve(0) : tableParty(restaurantId, tableId, member.sessionId),
      splitInProgress(restaurantId, tableId, member.sessionId),
    ]);
    return NextResponse.json({ orders, staffBill, party, dividing });
  } catch (error) {
    if (error instanceof PaymentAttributionRequired) return await apiError("apiErr.attributionRequired", 409);
    return await apiError("apiErr.ordersLoad", 500);
  }
}
