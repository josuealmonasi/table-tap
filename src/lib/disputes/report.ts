import type { DisputeCase, DisputeMovement, DisputeReport } from "./types";

export function minorUnits(amount: number, currency: string): number {
  const digits = new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
  return amount / 10 ** (digits ?? 2);
}

/** Provider dates apply even when the original sale is outside this period.
 * Cases supply current exposure; their charge currency never relabels cash. */
export function disputeReport(cases: DisputeCase[], movements: DisputeMovement[], since: string, until: string, pending: number): DisputeReport {
  const currencies = new Map<string, DisputeReport["currencies"][number]>();
  const row = (currency: string) => {
    if (!currencies.has(currency)) currencies.set(currency, { currency, withdrawn: 0, reinstated: 0, fees: 0, net: 0, exposure: 0 });
    return currencies.get(currency)!;
  };
  for (const tx of movements.filter(t => t.provider_created_at >= since && t.provider_created_at < until)) {
    const total = row(tx.currency);
    total.withdrawn += minorUnits(Math.min(0, tx.amount_minor), tx.currency);
    total.reinstated += minorUnits(Math.max(0, tx.amount_minor), tx.currency);
    total.fees += minorUnits(tx.fee_minor, tx.currency);
    total.net += minorUnits(tx.net_minor, tx.currency);
  }
  for (const dispute of cases) {
    if (!["won", "lost", "warning_closed", "prevented"].includes(dispute.status)) row(dispute.currency).exposure += minorUnits(dispute.amount_minor, dispute.currency);
  }
  return { currencies: [...currencies.values()].sort((a, b) => a.currency.localeCompare(b.currency)), pending,
    won: cases.filter(d => d.status === "won").length, lost: cases.filter(d => d.status === "lost").length };
}
