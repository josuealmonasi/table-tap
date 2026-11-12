import { receiptCents } from "@/lib/receipt-amount";
import { everyRow } from "@/lib/paged";
import { linesOf, type StatementCharge } from "@/lib/accounts";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { WriteOffReason } from "@/lib/write-off";

export interface AccountCreditLine {
  at: string; amount: number; currency: string;
  actor?: string; reason?: WriteOffReason; note?: string | null;
}
interface CreditRow {
  resulting_total: number;
  order_id: string; created_at: string; forgiven: number; currency: string;
  actor: string; reason: WriteOffReason; note: string | null;
  orders: { id: string; items: unknown; charged_at: string | null; created_at: string; table_label: string | null };
}

/** Read independently of the unpaid orders, then reconcile the two snapshots. */
export async function readAccountCredits(db: ReturnType<typeof createAdminClient>, restaurantId: string,
  accountId: string): Promise<CreditRow[]> {
  return await everyRow<CreditRow>((a, b) => db.from("order_adjustments")
    .select("order_id, resulting_total, created_at, forgiven, currency, actor, reason, note, orders!inner(id, items, charged_at, created_at, table_label, account_id)")
    .eq("restaurant_id", restaurantId).eq("kind", "account_credit").eq("orders.account_id", accountId)
    .order("created_at").order("id").range(a, b).returns<CreditRow[]>(), "the account's credits");
}

/** Keep credited orders visible after full relief or later collection. Their
 * history has zero debt; only the independently filtered unpaid read owes. */
export async function withAccountCredits(db: ReturnType<typeof createAdminClient>, restaurantId: string,
  accountId: string, charges: StatementCharge[], history?: CreditRow[]): Promise<StatementCharge[]> {
  const rows = history ?? await readAccountCredits(db, restaurantId, accountId);
  const result = new Map(charges.map(c => [c.orderId, { ...c, credits: [] as AccountCreditLine[] }]));
  for (const row of rows) {
    let charge = result.get(row.order_id);
    if (!charge) {
      const o = row.orders;
      charge = { orderId: row.order_id, currency: row.currency, at: o.charged_at ?? o.created_at,
        tableLabel: o.table_label, lines: linesOf(o.items), total: 0, creditable: false, credits: [] };
      result.set(row.order_id, charge);
    }
    charge.credits.push({ at: row.created_at, amount: Number(row.forgiven), currency: row.currency,
      actor: row.actor, reason: row.reason, note: row.note });
  }
  for (const charge of charges) {
    const credits = rows.filter(row => row.order_id === charge.orderId);
    if (credits.length && receiptCents(charge.total) !== Math.min(...credits.map(row => receiptCents(row.resulting_total)))) {
      throw new Error("The account changed while reading its credits");
    }
  }
  return [...result.values()];
}
