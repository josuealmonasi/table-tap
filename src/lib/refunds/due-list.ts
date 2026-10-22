import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import { refundDue, type RefundDueRow } from "@/lib/refund-due";
import { verifyDueCurrency } from "./due-recovery";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

type Db = ReturnType<typeof createAdminClient>;

export async function refundsDue(restaurantId: string): Promise<RefundDueRow[]> {
  // Provider outages must not hold up opening Bills or collecting another sale.
  after(() => recoverRefundDues(restaurantId).catch(error => console.error("Refund due recovery remains pending", error)));
  const db = createAdminClient();
  return everyRow<RefundDueRow>((a, b) => db.from("refunds_due")
    .select("id, amount, currency, table_label, account_name, created_at, refunded_at")
    .eq("restaurant_id", restaurantId).or("refunded_at.is.null,fee_reconciled_at.is.null")
    .order("id").range(a, b), "the refunds due");
}

/** A restart must not hide outstanding fees behind customer completion. */
export async function recoverRefundDues(restaurantId: string, db: Db = createAdminClient(), client: Stripe = stripe): Promise<void> {
  const pending = await everyRow<{ id: string; currency: string | null; refunded_at: string | null; fee_reconciled_at: string | null }>((a, b) => db.from("refunds_due")
    .select("id, currency, refunded_at, fee_reconciled_at").eq("restaurant_id", restaurantId)
    .or("currency.is.null,and(refunded_at.not.is.null,fee_reconciled_at.is.null)")
    .order("id").range(a, b), "the refund currencies and fees awaiting verification");
  for (const row of pending) {
    // Preparing a request freezes its original account but never refunds a
    // customer here: giving back their payment still needs the manager's click.
    if (!row.currency) {
      const { data: attempt, error } = await db.rpc("start_refund_due_attempt", { p_restaurant: restaurantId, p_due: row.id });
      if (error || !attempt) continue;
      await verifyDueCurrency(db, restaurantId, row.id, attempt, client)
        .catch(error => console.error("Refund due currency remains unverified", error));
    }
    if (row.refunded_at && !row.fee_reconciled_at) await refundDue(db, restaurantId, row.id, "fee recovery", client);
  }
}
