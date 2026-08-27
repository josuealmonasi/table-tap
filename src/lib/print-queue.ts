import { createAdminClient } from "@/lib/supabase/admin";
import { orderCode, type Order } from "@/lib/types";
import { slipFor } from "@/lib/printing";

/**
 * Queues a ticket for every active printer at the restaurant.
 *
 * Called when the order genuinely reaches the kitchen — on payment confirming,
 * or on placing it where the table pays at the end — and never before: a sheet
 * for an order that might still go unpaid is food somebody starts cooking for
 * nada.
 *
 * Fails silently on purpose. If printing blows up the order already exists and
 * the screen shows it anyway; taking checkout down because a printer will not
 * answer would trade an annoyance for a lost sale.
 */
export async function queueSlips(order: Order): Promise<number> {
  try {
    const db = createAdminClient();
    const { data: printers } = await db
      .from("printers")
      .select("id")
      .eq("restaurant_id", order.restaurant_id)
      .eq("active", true);

    if (!printers?.length) return 0;

    const body = slipFor(order, orderCode(order.id));
    const { error } = await db.from("print_jobs").upsert(
      printers.map(p => ({
        restaurant_id: order.restaurant_id,
        printer_id: p.id,
        order_id: order.id,
        body,
      })),
      // The same order is not queued twice for the same printer: Stripe's webhook
      // can arrive more than once, and that is normal.
      { onConflict: "order_id,printer_id", ignoreDuplicates: true },
    );
    return error ? 0 : printers.length;
  } catch {
    return 0;
  }
}
