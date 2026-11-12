import { after } from "next/server";
import { drainTicketEmails } from "@/lib/ticket-email";
import { NextRequest } from "next/server";
import { actingStaff } from "@/lib/api-guard";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { TAKES_COUNTER_ORDERS } from "@/lib/membership";
import { receiveOffline } from "@/lib/offline-intake";
import { otherRestaurant, type PosSaleBody } from "@/lib/pos-sale";

export const runtime = "nodejs";

/** Uploading held money never grants permission to ring or approve a sale. */
export async function POST(req: NextRequest) {
  const actor = await actingStaff();
  if (!actor || !TAKES_COUNTER_ORDERS(actor.role)) return await apiError("apiErr.forbidden", 403);
  const body = await jsonBody<PosSaleBody & { offline?: unknown }>(req);
  if (!body || body.offline === undefined) return await apiError("apiErr.invalidRequest", 400);
  const elsewhere = await otherRestaurant(body, actor.restaurantId);
  if (elsewhere) return elsewhere;
  // Tickets this request's payment queued for the card's email go out once it
  // has answered; registered only once the caller and the request are valid.
  after(() => drainTicketEmails());
  return await receiveOffline(actor, body, true);
}
