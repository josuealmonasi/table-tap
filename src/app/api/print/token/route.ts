import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { apiError } from "@/lib/api-error";
import { actingManager } from "@/lib/api-guard";
import { frozenBlocks } from "@/lib/plan-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";

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

  // 32 bytes. base64url so it survives a URL, a QR code and a printer's
  // configuration field without anything re-encoding it.
  const token = randomBytes(32).toString("base64url");

  const { error } = await createAdminClient()
    .from("restaurants")
    .update({ print_token: token })
    .eq("id", actor.restaurantId);
  if (error) return await apiError("apiErr.printerTokenFailed", 500);

  await logEvent({
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "settings",
    action: "updated",
    // Field and verb, the way the rest of the log is written — and never the
    // value. An activity log is read by more people than the settings screen.
    detail: "print_token: rotated",
  });

  return NextResponse.json({ token });
}
