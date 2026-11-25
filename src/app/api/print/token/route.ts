import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingManager } from "@/lib/api-guard";
import { frozenBlocks } from "@/lib/plan-guard";
import { rotatePrintToken } from "@/lib/staff-removal";

export const runtime = "nodejs";

/**
 * Issues the kitchen printer's URL, and reissues it on demand.
 *
 * A printer cannot log in, so the URL it is configured with is the whole
 * credential. That has one consequence worth stating plainly: this route is
 * the only way to get one, and it is behind the same door as the rest of the
 * desk work — owner or manager, nobody else. A cashier never sees it.
 *
 * Calling it again replaces the old token. That is the revocation story: a URL
 * that ended up in a photo of the back office stops working the moment
 * somebody presses the button, and the printer is reconfigured with the new
 * one. Old and new never coexist, which is what makes "rotate" mean something.
 */
export async function POST() {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const frozen = await frozenBlocks(actor.restaurantId);
  if (frozen) return frozen;

  const token = await rotatePrintToken(actor.restaurantId, actor.email);
  if (!token) return await apiError("apiErr.printerTokenFailed", 500);

  return NextResponse.json({ token });
}
