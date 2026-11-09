import { formatMoney } from "@/lib/format";
import { escapeHtml } from "@/lib/html";
import type { ShiftView } from "@/lib/cash-shift";

/**
 * The corte sheet's drawer rows: what each shift was expected to hold, what
 * was counted, and the difference.
 *
 * In the shift's own saved currency, as its record on screen shows it: a corte
 * printed after the restaurant switched to USD labelled a peso drawer
 * "$100.00 USD" (sweep 4, finding 3).
 */
export function corteShiftRows(shifts: ShiftView[], currency: string, t: (key: string) => string): string {
  return shifts
    .map(({ shift, sum }) => {
      const money = (n: number) => formatMoney(n, shift.currency || currency);
      return `<tr><td style="padding:2px 18px 2px 0">${escapeHtml(shift.closed_by ?? shift.opened_by)}${shift.closed_at ? "" : ` (${escapeHtml(t("shift.stillOpen"))})`}</td>` +
        `<td style="padding:2px 18px 2px 0">${money(Number(shift.expected_cash ?? sum.expected))}</td>` +
        `<td style="padding:2px 18px 2px 0">${shift.counted_cash == null ? "—" : money(Number(shift.counted_cash))}</td>` +
        `<td>${shift.difference == null ? "—" : money(Number(shift.difference))}</td></tr>`;
    })
    .join("");
}
