import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingStaff } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildReceipt } from "@/lib/receipt";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";
import { DEFAULT_LOCALE, messagesFor, translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

export const runtime = "nodejs";

/**
 * Printing an order that already exists.
 *
 * Two different pieces of paper, asked for from the same dialog:
 *
 *   `kitchen` — put it back on the kitchen printer. For a ticket that jammed,
 *   or one the pass never saw because the printer was off when it was placed.
 *   Works whatever column the order is in, and works from the history: an
 *   order that is finished can still need a copy.
 *
 *   `receipt` — the customer's ticket, handed back to the browser to print.
 *   The same document the till prints and the same one an email carries, so a
 *   reprint cannot say something different from the original.
 *
 * Any of the team may ask. Reprinting costs paper and reveals nothing that the
 * screen they asked from was not already showing them.
 */
export async function POST(req: NextRequest) {
  const actor = await actingStaff();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  const { orderId, to } = (await req.json().catch(() => ({}))) as {
    orderId?: string;
    to?: "kitchen" | "receipt";
  };
  if (!orderId || (to !== "kitchen" && to !== "receipt")) {
    return await apiError("apiErr.invalidRequest", 400);
  }

  const db = createAdminClient();
  // Scoped to the caller's own restaurant, so an id from anywhere else is
  // simply not found.
  const { data: order } = await db
    .from("orders")
    .select(
      "id, restaurant_id, items, subtotal, discount, service_fee, tip, total, currency, table_label, created_at, pay_method",
    )
    .eq("id", orderId)
    .eq("restaurant_id", actor.restaurantId)
    .maybeSingle();
  if (!order) return await apiError("apiErr.orderNotFound", 404);

  if (to === "kitchen") {
    const { data: place } = await db
      .from("restaurants")
      .select("print_token")
      .eq("id", actor.restaurantId)
      .maybeSingle();
    // Queuing a ticket for a printer that does not exist would look like it
    // worked and print nothing, forever.
    if (!place?.print_token) return await apiError("apiErr.noPrinter", 409);

    // Re-arm rather than insert. `print_jobs_once` is unique on
    // (order_id, kind) — it exists so a repeated trigger cannot put the same
    // ticket on the paper twice, and a second insert here would be refused by
    // it. Asking again deliberately is a different act from asking twice by
    // accident: the row goes back in the queue, unclaimed and unprinted.
    const { error } = await db
      .from("print_jobs")
      .upsert(
        {
          restaurant_id: actor.restaurantId,
          order_id: order.id as string,
          kind: "kitchen",
          claimed_at: null,
          printed_at: null,
          created_at: new Date().toISOString(),
        },
        { onConflict: "order_id,kind" },
      );
    if (error) return await apiError("apiErr.generic", 500);
    return NextResponse.json({ queued: true });
  }

  const { data: place } = await db
    .from("restaurants")
    .select("name, timezone")
    .eq("id", actor.restaurantId)
    .maybeSingle();

  const locale = await getLocale();
  const messages = messagesFor(locale ?? DEFAULT_LOCALE);
  const receipt = buildReceipt(
    [order as never],
    {
      name: place?.name ?? "TableTap",
      timeZone: (place?.timezone as string | null) ?? DEFAULT_TIME_ZONE,
      locale: locale === "en" ? "en-US" : "es-MX",
    },
    (key, vars) => translate(messages, key, vars),
  );
  return NextResponse.json({ html: receipt.html });
}
