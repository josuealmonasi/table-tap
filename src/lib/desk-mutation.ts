import type { NextRequest, NextResponse } from "next/server";
import { actingManager, type Actor } from "@/lib/api-guard";
import { apiError } from "@/lib/api-error";
import { frozenBlocks } from "@/lib/plan-guard";

/**
 * Desk writes need both a manager and an open subscription before any work.
 * Keeping the checks together prevents a new verb from missing the freeze,
 * as icon-group deletion did. Floor payments and sign-out do not come here.
 */
export function deskMutation(
  write: (req: NextRequest, actor: Actor) => Promise<NextResponse>,
): (req: NextRequest) => Promise<NextResponse> {
  return async req => {
    const actor = await actingManager();
    if (!actor) return await apiError("apiErr.forbidden", 403);
    const frozen = await frozenBlocks(actor.restaurantId);
    if (frozen) return frozen;
    return write(req, actor);
  };
}
