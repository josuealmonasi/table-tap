import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingOwner } from "@/lib/api-guard";
import { frozenBlocks } from "@/lib/plan-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { newPrinterToken } from "@/lib/printing";

export const runtime = "nodejs";

/**
 * Adding and removing printers. Owner only: the token it returns is a
 * long-lived credential that prints their customers' orders.
 *
 * Shown ONCE, on creation. Storing it to show again would be keeping a
 * recoverable secret where none is needed: if it is lost, delete the printer
 * and add it again. See docs/printing.md.
 */
export async function POST(req: NextRequest) {
  const actor = await actingOwner();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const frozen = await frozenBlocks(actor.restaurantId);
  if (frozen) return frozen;

  const { name } = (await req.json().catch(() => ({}))) as { name?: string };
  if (!name?.trim()) return await apiError("apiErr.invalidRequest", 400);

  const token = newPrinterToken();
  const { data, error } = await createAdminClient()
    .from("printers")
    .insert({ restaurant_id: actor.restaurantId, name: name.trim().slice(0, 40), token })
    .select("id, name")
    .single();

  if (error) return await apiError("apiErr.invalidRequest", 500);

  const origin = req.headers.get("origin") ?? new URL(req.url).origin;
  return NextResponse.json({
    printer: data,
    // The whole string typed into the device, so nobody assembles it by hand.
    url: `${origin}/api/print/cloudprnt/${token}`,
  });
}

export async function DELETE(req: NextRequest) {
  const actor = await actingOwner();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return await apiError("apiErr.invalidRequest", 400);

  // Scoped to the caller's restaurant: another's id finds nothing.
  const { error } = await createAdminClient()
    .from("printers")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", actor.restaurantId);

  if (error) return await apiError("apiErr.invalidRequest", 500);
  return NextResponse.json({ ok: true });
}
