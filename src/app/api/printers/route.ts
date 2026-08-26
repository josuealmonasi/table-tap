import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingOwner } from "@/lib/api-guard";
import { frozenBlocks } from "@/lib/plan-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { newPrinterToken } from "@/lib/printing";

export const runtime = "nodejs";

/**
 * Alta y baja de impresoras. Del dueño: el token que devuelve es una
 * credencial de larga vida que imprime los pedidos de sus clientes.
 *
 * Se enseña UNA vez, al crearla. Guardarlo para volver a mostrarlo sería tener
 * un secreto recuperable donde no hace falta: si se pierde, se borra la
 * impresora y se agrega otra vez. Ver docs/printing.md.
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
    // Lo que se teclea en el aparato, entero, para no armarlo a mano.
    url: `${origin}/api/print/cloudprnt/${token}`,
  });
}

export async function DELETE(req: NextRequest) {
  const actor = await actingOwner();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return await apiError("apiErr.invalidRequest", 400);

  // Acotado al restaurante de quien pide: un id de otro no encuentra nada.
  const { error } = await createAdminClient()
    .from("printers")
    .delete()
    .eq("id", id)
    .eq("restaurant_id", actor.restaurantId);

  if (error) return await apiError("apiErr.invalidRequest", 500);
  return NextResponse.json({ ok: true });
}
