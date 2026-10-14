"use client";

import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { parseLogDetail } from "@/lib/log-detail";

/** The parts of a log row these words are made from. */
export interface LogWordsRow {
  entity: string;
  action: string;
  detail: string | null;
  target_email?: string | null;
}

/** Cash-drawer fields recorded as bare numbers: read as money. */
const MONEY_FIELDS = ["withdrawal", "opening", "counted", "expected", "difference"] as const;

/**
 * A log row in the reader's language: what happened ("wrote off a bill") and
 * its specifics ("Table 4 · MX$120.00 · cash"). Shared by the activity log
 * and a cash shift's trail, so the same record reads the same in both.
 */
export function useLogWords(currency: string): {
  describe: (log: LogWordsRow) => string;
  specifics: (log: LogWordsRow) => string;
} {
  const t = useT();

  /**
   * The specifics, in the reader's language: the server wrote them as fields
   * because it had no way of knowing who would read them.
   */
  const specifics = (log: LogWordsRow): string => {
    const fields = parseLogDetail(log.detail);
    if (!fields) return log.detail ?? log.target_email ?? "";
    const parts: string[] = [];
    if (fields.table) parts.push(t("dash.tableN", { label: fields.table }));
    if (fields.code) parts.push(fields.code);
    if (fields.orders) parts.push(t("dash.logOrders", { n: fields.orders }));
    if (fields.amount) parts.push(formatMoney(Number(fields.amount), currency));
    if (fields.method) parts.push(t(`dash.pay${fields.method}`));
    if (fields.order) parts.push(`#${fields.order}`);
    // What a part-payment left behind, so the line says how much of the bill
    // this was rather than just how much changed hands.
    if (fields.left) {
      parts.push(t("dash.logLeft", { amount: formatMoney(Number(fields.left), currency) }));
    }
    for (const key of MONEY_FIELDS) {
      if (fields[key]) parts.push(`${t(`log.cashField.${key}`)} ${formatMoney(Number(fields[key]), currency)}`);
    }
    if (fields.note) parts.push(fields.note);
    if (fields.explained) parts.push(fields.explained);
    const shown = ["table", "code", "orders", "amount", "method", "order", "left", "note", "explained", ...MONEY_FIELDS];
    for (const [key, value] of Object.entries(fields)) {
      if (!shown.includes(key)) parts.push(`${key}: ${value}`);
    }
    return parts.join(" · ");
  };

  /** "wrote off a bill", "changed a setting" — in the reader's language. */
  const describe = (log: LogWordsRow): string => {
    const key = `log.${log.entity}.${log.action}`;
    const line = t(key);
    // A combination we haven't named yet reads as plain words rather than a
    // key: the log is a record first, and must never show its own internals.
    return line === key ? `${t(`log.entity.${log.entity}`)} · ${log.action}` : line;
  };

  return { describe, specifics };
}
