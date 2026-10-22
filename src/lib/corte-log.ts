import { parseLogDetail } from "@/lib/log-detail";
import type { CorteAdjustment } from "@/lib/corte";

export interface CorteLog extends CorteAdjustment {
  entity: string;
}

/** A waste entry is not a bill write-off, and an approved discount is the
 * same money as a directly granted one. Unknown currencies are review work,
 * never permission to treat yesterday's pesos as today's dollars. */
export function corteLogs(rows: CorteLog[], currency: string): { verified: CorteAdjustment[]; unverified: number } {
  const verified: CorteAdjustment[] = [];
  let unverified = 0;
  for (const row of rows) {
    const eligible = (row.entity === "bill" && row.action === "written_off")
      || (row.entity === "discount" && ["discounted", "approved"].includes(row.action))
      || (row.entity === "account" && row.action === "charged")
      || (["order", "bill"].includes(row.entity) && row.action === "refunded");
    const fields = parseLogDetail(row.detail);
    if (!eligible || !fields?.amount || !Number.isFinite(Number(fields.amount))) continue;
    // Duplicate-payment returns never entered takings and deliberately carry
    // no method. They must not be subtracted here, in any currency.
    if (row.action === "refunded" && !["cash", "card"].includes(fields.method)) continue;
    if (!["MXN", "USD"].includes(fields.currency)) unverified++;
    else if (fields.currency === currency) verified.push({ ...row, action: row.action === "approved" ? "discounted" : row.action });
  }
  return { verified, unverified };
}
