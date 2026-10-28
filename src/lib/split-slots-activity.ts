import type { Actor } from "@/lib/api-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { logDetail } from "@/lib/log-detail";

/** The receipt includes old unpaid gratuities inside the parts as well as the new tip. */
export async function logSlotReceipt(actor: Actor, paymentId: string | undefined, ref: string): Promise<void> {
  try {
    const db = createAdminClient();
    const query = db.from("payments").select("id, amount, tip, currency, method, actor_email, created_at, session_id")
      .eq("restaurant_id", actor.restaurantId);
    // The SQL duplicate result has no payment id; its saved reference still
    // finds the original receipt, including its cashier and collection time.
    const { data, error } = await (paymentId ? query.eq("id", paymentId) : query.eq("client_ref", ref)).single();
    if (error || !data) throw new Error("Could not read the split collection receipt for its activity");
    const { data: order } = await db.from("orders").select("table_label")
      .eq("restaurant_id", actor.restaurantId).eq("session_id", data.session_id).limit(1).maybeSingle();
    // The receipt id is also this event's id. Concurrent retries insert once,
    // never replacing history or counting the same cash again after a lost reply.
    const { error: logError } = await db.from("user_logs").upsert({
      id: data.id, restaurant_id: actor.restaurantId, actor_email: data.actor_email,
      created_at: data.created_at, entity: "bill", action: "collected",
      detail: logDetail({ payment: data.id, table: order?.table_label,
        amount: Number(data.amount).toFixed(2), tip: Number(data.tip).toFixed(2), currency: data.currency, method: data.method }),
    }, { onConflict: "id", ignoreDuplicates: true });
    if (logError) throw new Error(`Could not log the split collection receipt: ${logError.message}`);
  } catch (error) {
    // Activity is best-effort, as for every table collection. A saved receipt
    // must not make the cashier take the same money again after a log failure.
    console.error("split collection activity:", error);
  }
}
