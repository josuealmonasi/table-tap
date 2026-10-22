import { localDay, type DepositRecord, type TerminalPayment } from "./terminal";
import { round2 } from "./money";

export interface TerminalReturn {
  id: string;
  paymentId?: string;
  saleDay: string;
  day: string;
  at: string;
  amount: number;
  tip: number;
}

/** Keep the allocation's original sale date: only a same-day void returns the fee. */
export function terminalReturns(payments: TerminalPayment[], timeZone: string): TerminalReturn[] {
  return payments.flatMap(p => {
    const at = p.returned_at || p.voided_at;
    if (!at) return [];
    return [{ id: p.returned_at ? p.id ?? "" : `void:${p.id}`, paymentId: p.payment_id ?? p.id,
      saleDay: p.returned_at && !p.payment_id ? "" : localDay(p.created_at, timeZone), day: localDay(at, timeZone), at, amount: Number(p.amount), tip: Number(p.tip) || 0 }];
  });
}

/** An old mark has no manifest. Keep its timestamp rule only for that old history. */
export function returnDeposit(r: TerminalReturn, deposits: DepositRecord[], salesDays: string[]): DepositRecord | undefined {
  return deposits.find(d => d.return_ids?.includes(r.id)) ?? deposits.find(d => d.return_ids == null
    && r.at <= d.created_at && d.sales_day === salesDays.find(day => day >= r.day));
}

export function carriedReturn(r: TerminalReturn, feePct: number): number {
  return r.saleDay === r.day ? round2(r.amount - round2(r.amount * feePct / 100)) : r.amount;
}

export function waitingDay(day: string, marked: Map<string, DepositRecord>): string {
  while (marked.has(day)) {
    const next = new Date(`${day}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    day = next.toISOString().slice(0, 10);
  }
  return day;
}
