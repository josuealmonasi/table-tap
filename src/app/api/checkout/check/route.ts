import { NextResponse, type NextRequest } from "next/server";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { MANAGES } from "@/lib/membership";
import { paymentCheckScope } from "@/lib/payment-check";
import { paymentCheckTarget } from "@/lib/payment-check-target";
import { resolveCheckoutPages } from "@/lib/whole-bill-pages";
import { resolveSelectedSplitPages } from "@/lib/split-page-recovery";

export const runtime = "nodejs";

/** Check the refused scope. Never call the collection or decision that refused it. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingFrontOfHouse();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const scope = paymentCheckScope(await jsonBody(req));
  if (!scope) return await apiError("apiErr.invalidRequest", 400);
  if (scope.kind === "approval" && !MANAGES(actor.role)) return await apiError("apiErr.forbidden", 403);
  try {
    const target = await paymentCheckTarget(actor.restaurantId, scope);
    if (!target) return await apiError("apiErr.notFound", 404);
    const result = scope.kind === "split" && scope.slots
      ? await resolveSelectedSplitPages(actor.restaurantId, scope.splitId, scope.slots, true)
      : await resolveCheckoutPages(actor.restaurantId, target, true);
    return NextResponse.json({ outcome: result === "unresolved" ? "unverified" : result });
  } catch {
    return NextResponse.json({ outcome: "unverified" });
  }
}
