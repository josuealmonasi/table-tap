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
  amount: number;
  /** The tip inside `amount`. */
  tip: number;
  created_at: string;
}

export interface DepositRecord {
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
  expected: number;
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

function statusOf(expected: number, expectedOn: string, deposit: DepositRecord | null, today: string): DepositStatus {
  if (deposit) {
    const difference = Number(deposit.received) - expected;
    if (Math.abs(difference) < DEPOSIT_TOLERANCE) return "received";
    return difference < 0 ? "short" : "over";
  }
  if (today > expectedOn) return "overdue";
  return today === expectedOn ? "due" : "pending";
}

/**
 * Every day with terminal card payments, newest first: what was taken, the
 * tips inside it, the fee, what should be deposited and when, and whether it
 * was. A day marked deposited keeps the expected figure from when it was
 * marked — a payment refunded later must not rewrite what was reconciled.
 */
export function depositDays(
  payments: TerminalPayment[],
  deposits: DepositRecord[],
  feePct: number,
  settleDays: number,
  timeZone: string,
  today: string,
): DepositDay[] {
  const byDay = new Map<string, { count: number; takings: number; tips: number }>();
  for (const p of payments) {
    const day = localDay(p.created_at, timeZone);
    const row = byDay.get(day) ?? { count: 0, takings: 0, tips: 0 };
    row.count += 1;
    row.takings += Number(p.amount);
    row.tips += Number(p.tip) || 0;
    byDay.set(day, row);
  }
  const marked = new Map(deposits.map(d => [d.sales_day, d]));
  for (const day of marked.keys()) if (!byDay.has(day)) byDay.set(day, { count: 0, takings: 0, tips: 0 });

  return [...byDay.entries()]
    .map(([day, row]) => {
      const deposit = marked.get(day) ?? null;
      const fee = round2(row.takings * (feePct / 100));
      const expected = deposit ? Number(deposit.expected) : round2(row.takings - fee);
      const expectedOn = addBusinessDays(day, settleDays);
      return {
        day, count: row.count, takings: round2(row.takings), tips: round2(row.tips), fee, expected, expectedOn,
        deposit, status: statusOf(expected, expectedOn, deposit, today),
      };
    })
    .sort((a, b) => b.day.localeCompare(a.day));
}
