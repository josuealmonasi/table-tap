import { createHash } from "node:crypto";
import type { RecoveryContext } from "./job";
import type { SavedRefund } from "./refund-item";

/** One reminder per restaurant, including overlapping cron deliveries. A
 * read-then-insert check alone lets both workers ring the bell at once. */
export async function notifyOverdueDue(context: RecoveryContext, row: SavedRefund): Promise<void> {
  const due = row.refunds_due;
  // The existing bell formats money from its original currency. An unknown
  // currency must stay in logs rather than being called pesos by the UI.
  if (!due?.currency || !due.amount) return;
  const hash = createHash("sha256").update(`recovery:refund_due:${row.restaurant_id}`).digest("hex");
  const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const { error } = await context.db.from("notifications").upsert({ id, restaurant_id: row.restaurant_id,
    kind: "refund_due", data: { amount: due.amount, currency: due.currency, table: due.table_label, account: due.account_name },
  }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new Error(`Could not write the overdue refund reminder: ${error.message}`);
}
