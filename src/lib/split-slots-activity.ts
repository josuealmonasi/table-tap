import type { Actor } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";

/** The receipt includes old unpaid gratuities inside the parts as well as the new tip. */
export async function logSlotReceipt(actor: Actor, paymentId: string, table: string | null | undefined, left: number, settled: boolean): Promise<void> {
  try {
    const { data, error } = await createAdminClient().from("payments").select("amount, tip, currency, method")
      .eq("restaurant_id", actor.restaurantId).eq("id", paymentId).single();
    if (error || !data) throw new Error("Could not read the split collection receipt for its activity");
    await logEvent({ restaurantId: actor.restaurantId, actor: actor.email, entity: "bill", action: settled ? "paid" : "collected",
      detail: logDetail({ table, amount: Number(data.amount).toFixed(2), tip: Number(data.tip).toFixed(2),
        currency: data.currency, method: data.method, left: settled ? null : left.toFixed(2) }) });
  } catch (error) {
    // Activity is best-effort, as for every table collection. A saved receipt
    // must not make the cashier take the same money again after a log failure.
    console.error("split collection activity:", error);
  }
}
