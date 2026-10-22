import { terminalReturns, returnDeposit, carriedReturn, waitingDay } from "./terminal-returns";
import { round2 } from "@/lib/money";

/**
 * What the restaurant's own card terminal should deposit, day by day.
 *
 * A day's card payments on the terminal, less the terminal's fee, should
 * reach the bank a set number of business days later. Weekends are skipped;
 * bank holidays are not known, so a deposit due on one reads as late a day
 * early — which is the safe way round to be wrong.
 *
 * Pure.
 */

export interface TerminalPayment {
  id?: string;
  /** The original receipt, reached through the return allocation. */
  payment_id?: string;
  amount: number;
  /** A confirmed partial terminal return, booked at its own time; created_at stays the original payment date. */
  returned_at?: string;
  /** The tip inside `amount`. */
  tip: number;
  created_at: string;
  /** When the server recorded it; later than `created_at` for a sale held offline. */
  recorded_at?: string | null;
  /** When its sale was cancelled and it was voided on the terminal; null when it stands. */
  voided_at?: string | null;
}

export interface DepositRecord {
  /** Exact membership at the money-lock cutoff; null only on pre-snapshot marks. */
  payment_ids?: string[] | null;
  return_ids?: string[] | null;
  snapshot_at?: string | null;
  fee_pct?: number | null;
  /** Null on older deposits until their bank receipt verifies the currency. */
  currency?: string | null;
  sales_day: string;
  expected: number;
  received: number;
  note: string | null;
  recorded_by: string;
  created_at: string;
}

export type DepositStatus = "pending" | "due" | "overdue" | "received" | "short" | "over";

export interface DepositDay {
  /** The restaurant's own calendar day, YYYY-MM-DD. */
  day: string;
  count: number;
  takings: number;
  tips: number;
  fee: number;
  /** Voided on the terminal for sales of earlier days: comes out of this deposit. */
  givenBack: number;
  expected: number;
  /**
   * On a day already marked deposited: what arrived after it was marked —
   * card sales the till held offline, net of the fee. The deposit is judged
   * against `expected + late`; `expected` stays what was reconciled.
   */
  late: number;
  /** The business day the bank should pay it, YYYY-MM-DD. */
  expectedOn: string;
  deposit: DepositRecord | null;
  status: DepositStatus;
}

/** Within this of what was expected, a deposit is simply received. */
export const DEPOSIT_TOLERANCE = 0.5;

/** The calendar day an instant falls on in the restaurant's zone, YYYY-MM-DD. */
export function localDay(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** `n` business days after a calendar day: Saturdays and Sundays do not count. */
export function addBusinessDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const weekday = d.getUTCDay();
    if (weekday !== 0 && weekday !== 6) left--;
  }
  // A day's sales that settle "in 0 days" still land on a business day.
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function statusOf(expected: number, expectedOn: string, deposit: DepositRecord | null, today: string, count: number): DepositStatus {
  if (deposit) {
    const difference = Number(deposit.received) - expected;
    if (Math.abs(difference) < DEPOSIT_TOLERANCE) return "received";
    return difference < 0 ? "short" : "over";
  }
  // Nothing of its own to deposit: what it gave back waits on the next sale.
  if (count === 0) return "pending";
  if (today > expectedOn) return "overdue";
  return today === expectedOn ? "due" : "pending";
}

/**
 * Every day with terminal card payments, newest first: what was taken, the
 * tips inside it, the fee, what should be deposited and when, and whether it
 * was. A day marked deposited keeps the expected figure from when it was
 * marked — a payment refunded later must not rewrite what was reconciled.
 *
 * A cancelled sale was voided on the terminal by a person, as the cancel
 * dialog asks. Voided the day it was taken, the bank never pays it, so it
 * counts nowhere. Voided on a later day, the bank paid it and takes it back
 * out of a deposit to come: the first unsigned day's from the void on that has sales
 * of its own — the same day the corte takes it out of the drawer, when that
 * day had sales. Sales before `firstDay` are not listed; their voids still are.
 */
export function depositDays(
  payments: TerminalPayment[],
  deposits: DepositRecord[],
  feePct: number,
  settleDays: number,
  timeZone: string,
  today: string,
  firstDay = "",
): DepositDay[] {
  const byDay = new Map<string, { count: number; takings: number; tips: number; givenBack: number; late: number }>();
  const rowOf = (day: string) => {
    const row = byDay.get(day) ?? { count: 0, takings: 0, tips: 0, givenBack: 0, late: 0 };
    byDay.set(day, row);
    return row;
  };
  const marked = new Map(deposits.map(d => [d.sales_day, d]));
  const returns = terminalReturns(payments, timeZone);
  for (const p of payments) {
    if (p.returned_at) continue;
    const day = localDay(p.created_at, timeZone);
    const deposit = marked.get(day);
    const sameDay = returns.filter(r => p.id && r.paymentId === p.id && r.day === day
      && (!deposit || deposit.return_ids?.includes(r.id) || (deposit.return_ids == null && r.at <= deposit.created_at)));
    // A legacy void has no allocation; its entire receipt is reversed.
    if (p.voided_at && localDay(p.voided_at, timeZone) === day
      && (!deposit || sameDay.length > 0)) continue;
    const amount = round2(Number(p.amount) - sameDay.reduce((n, r) => n + r.amount, 0));
    if (amount <= 0) continue;
    const row = rowOf(day);
    row.count += 1;
    row.takings += amount;
    row.tips += Number(p.tip) - sameDay.reduce((n, r) => n + r.tip, 0);
    // Recorded after its day was marked deposited: the bank paid it with
    // that day, and the figure reconciled then could not include it. Only
    // an arrival counts here — a later void is booked to a later day.
    // A manifest also catches transactions whose timestamp predates the lock.
    const late = deposit?.payment_ids != null ? !deposit.payment_ids.includes(p.id ?? "")
      : deposit && p.recorded_at && p.recorded_at > deposit.created_at;
    if (late) row.late += amount;
  }
  const salesDays = [...byDay.entries()].filter(([, row]) => row.count > 0).map(([day]) => day).sort();
  for (const r of returns) {
    const reconciled = returnDeposit(r, deposits, salesDays);
    if (reconciled) {
      // Same-day reversals are already absent from takings and fees.
      if (r.saleDay !== r.day || reconciled.sales_day !== r.day) rowOf(reconciled.sales_day).givenBack += carriedReturn(r, reconciled.fee_pct ?? feePct);
      continue;
    }
    if (r.saleDay === r.day && !marked.has(r.saleDay)) continue;
    const target = salesDays.find(day => day >= r.day && !marked.has(day)) ?? waitingDay(r.day, marked);
    rowOf(target).givenBack += carriedReturn(r, marked.get(r.saleDay)?.fee_pct ?? feePct);
  }
  for (const day of marked.keys()) rowOf(day);

  return [...byDay.entries()]
    .map(([day, row]) => {
      const deposit = marked.get(day) ?? null;
      const pct = deposit?.fee_pct ?? feePct;
      const fee = round2(row.takings * (pct / 100));
      const givenBack = round2(row.givenBack);
      const expected = deposit ? Number(deposit.expected) : round2(row.takings - fee - givenBack);
      const late = deposit ? round2(row.late - row.late * (pct / 100)) : 0;
      const expectedOn = addBusinessDays(day, settleDays);
      return {
        day, count: row.count, takings: round2(row.takings), tips: round2(row.tips), fee, givenBack, expected, late, expectedOn,
        deposit, status: statusOf(round2(expected + late), expectedOn, deposit, today, row.count),
      };
    })
    .filter(d => d.day >= firstDay || d.late !== 0)
    .sort((a, b) => b.day.localeCompare(a.day));
}
