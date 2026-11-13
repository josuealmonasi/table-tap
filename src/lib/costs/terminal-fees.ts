import type { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import { round2 } from "@/lib/money";
import { localDay, type DepositRecord, type TerminalPayment } from "@/lib/terminal";
import { terminalReturns } from "@/lib/terminal-returns";

/** Same ledger and original-day rates as terminal reconciliation. A later-day
 * return debits the bank gross and does not reverse the processing fee. */
export async function readTerminalFees(db: ReturnType<typeof createAdminClient>, restaurant: string, currency: string,
  since: string, end: string, timeZone: string, currentPct: number): Promise<number> {
  const [ledger, deposits] = await Promise.all([
    everyRow<TerminalPayment>((a, b) => db.rpc("terminal_deposit_ledger_v1", { p_restaurant: restaurant, p_currency: currency })
      .order("id").range(a, b), "the terminal's fee receipts and returns"),
    everyRow<Pick<DepositRecord, "sales_day" | "fee_pct" | "return_ids" | "created_at">>((a, b) => db.from("terminal_deposits").select("sales_day, fee_pct, return_ids, created_at")
      .eq("restaurant_id", restaurant).eq("currency", currency).order("sales_day").range(a, b), "the terminal's signed fee rates"),
  ]);
  const marked = new Map(deposits.map(d => [d.sales_day, d]));
  const net = new Map<string, number>();
  const inWindow = (at: string) => at >= since && at < end;
  for (const p of ledger) {
    if (p.returned_at || !inWindow(p.created_at)) continue;
    const day = localDay(p.created_at, timeZone);
    net.set(day, (net.get(day) ?? 0) + Number(p.amount));
  }
  let credits = 0;
  for (const r of terminalReturns(ledger, timeZone)) {
    if (r.saleDay !== r.day || !inWindow(r.at)) continue;
    const deposit = marked.get(r.saleDay);
    if (!deposit || deposit.return_ids?.includes(r.id) || (deposit.return_ids == null && r.at <= deposit.created_at)) {
      // Reconciliation rounds the fee on the day's net takings once.
      net.set(r.saleDay, (net.get(r.saleDay) ?? 0) - r.amount);
    } else {
      // A same-day return after sign-off carries its own rounded fee credit,
      // even if a later deposit uses a different rate to take new money.
      credits += round2(r.amount * (deposit.fee_pct ?? currentPct) / 100);
    }
  }
  return round2([...net].reduce((sum, [day, amount]) =>
    sum + round2(amount * (marked.get(day)?.fee_pct ?? currentPct) / 100), 0) - credits);
}
