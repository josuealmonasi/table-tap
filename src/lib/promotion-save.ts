import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import type { Body } from "@/lib/promotion-input";

/** Terms and components are one write, so a diner can never buy half an edit. */
export async function savePromotion(db: SupabaseClient, restaurantId: string, id: string | null, body: Body) {
  const { data, error } = await db.rpc("save_promotion_v1", {
    p_restaurant: restaurantId,
    p_id: id,
    p_fields: {
      kind: body.kind,
      name: body.name!.trim(),
      emoji: body.emoji || "🎁",
      description: body.description?.trim() || null,
      combo_price: body.kind === "combo" ? Number(body.comboPrice) : null,
      buy_qty: body.kind === "bogo" ? Math.floor(Number(body.buyQty)) : null,
      pay_qty: body.kind === "bogo" ? Math.floor(Number(body.payQty)) : null,
      tiers: body.kind === "tiered" ? body.tiers : null,
    },
    p_items: body.items!.map(i => ({ item_id: i.itemId, qty: Math.max(1, Math.floor(i.qty || 1)) })),
  });
  if (error?.message.includes("tt_plan_frozen")) return apiError("plan.frozen", 402);
  if (error) return apiError(id ? "apiErr.promoUpdate" : "apiErr.promoCreate", 500);
  if (!data) return apiError("apiErr.notFound", 404);
  return NextResponse.json({ ok: true });
}
