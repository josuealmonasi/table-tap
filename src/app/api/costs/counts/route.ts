import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { actingManager } from "@/lib/api-guard";
import { costsBlocks, uuidOf } from "@/lib/costs/guard";
import { decimal, MAX_INGREDIENTS, quantityRefusal } from "@/lib/costs/input";

export const runtime = "nodejs";

/** More of anything than a café's shelf holds, in g, ml or pieces. */
const MAX_COUNTED = 10_000_000;

// POST /api/costs/counts — { counts: [{ ingredientId, counted }] }: what was
// on the shelf. A blind count, like the drawer's: the counter sends what they
// counted before anybody tells them what was expected, the expected figure is
// worked out now and kept beside it, and only then does the answer come back.
// Owner and managers.
export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const blocked = await costsBlocks(actor.restaurantId);
  if (blocked) return blocked;
  const body = await jsonBody<{ counts?: unknown }>(req);
  if (!Array.isArray(body?.counts) || body.counts.length === 0 || body.counts.length > MAX_INGREDIENTS) {
    return await apiError("apiErr.countEmpty", 400);
  }
  const counted = new Map<string, number>();
  for (const raw of body.counts as { ingredientId?: unknown; counted?: unknown }[]) {
    const id = uuidOf(raw?.ingredientId);
    const quantity = decimal(raw?.counted, MAX_COUNTED, 3);
    if (!id || quantity === null || counted.has(id)) return await apiError(quantityRefusal(raw?.counted, "apiErr.countQuantity"), 400);
    counted.set(id, quantity);
  }

  // What the books say and where the count starts belong to one database
  // operation. A delivery between a read and an insert used to disappear.
  const { data, error } = await createAdminClient().rpc("record_ingredient_counts", {
    p_restaurant: actor.restaurantId, p_actor: actor.email,
    p_counts: [...counted].map(([ingredient_id, quantity]) => ({ ingredient_id, counted: quantity })),
  });
  if (error) return await apiError("apiErr.generic", 500);
  if (!data) return await apiError("apiErr.notFound", 404);
  const rows = data as { ingredient_id: string; counted: number; expected: number | null }[];
  await logEvent({
    restaurantId: actor.restaurantId, actor: actor.email, entity: "costs", action: "closed",
  });
  return NextResponse.json({
    ok: true,
    results: rows.map(r => ({ ingredientId: r.ingredient_id, counted: r.counted, expected: r.expected })),
  });
}
