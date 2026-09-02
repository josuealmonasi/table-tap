import { parseLogDetail } from "@/lib/log-detail";
import { EMPTY_TILL, tillFrom, type Till, type TillLine } from "@/lib/till";
import { round2 } from "@/lib/money";

/**
 * The register close — a "corte de caja".
 *
 * At the end of a day or a shift somebody counts the drawer against what the
 * system says was taken. That is a per-person question, not a per-restaurant
 * one: each till is counted by the person who filled it, and a single day
 * total cannot tell you which drawer is short.
 *
 * So this groups the day's settlements by who recorded them, splits cash from
 * card — only cash has to physically match — and states separately what never
 * arrived: bills written off and discounts given. A corte that shows only what
 * came in cannot be reconciled against a night where somebody walked out.
 *
 * Built from the activity log rather than from `orders`, because the log is
 * the only place that records WHO settled each bill.
 *
 * It will not always match the revenue tiles beside it, and that is correct.
 * The tiles count orders CREATED in the period; a corte counts money RECORDED
 * during the shift. A table that ordered at 23:50 and settled at 00:05 belongs
 * to yesterday's sales and to today's drawer — which is exactly what the person
 * counting that drawer needs it to do.
 */
export interface CorteRow {
  actor: string;
  entity: string;
  action: string;
  detail: string | null;
}

/** One person's drawer. */
export interface CorteLine extends Till {
  actor: string;
}

export interface Corte {
  /** Busiest first — the drawer most worth counting carefully. */
  people: CorteLine[];
  /** Everything collected, by everyone. */
  totals: Till;
  /** Served and never charged for. Not revenue, and not in the drawer. */
  writtenOff: number;
  /** Taken off bills as promotions. Also money that did not arrive. */
  discounted: number;
}

export const EMPTY_CORTE: Corte = {
  people: [],
  totals: EMPTY_TILL,
  writtenOff: 0,
  discounted: 0,
};

export function corteFrom(rows: CorteRow[]): Corte {
  const byActor = new Map<string, TillLine[]>();
  let writtenOff = 0;
  let discounted = 0;

  for (const row of rows) {
    const amount = Number(parseLogDetail(row.detail)?.amount);
    if (row.entity === "bill" && row.action === "paid") {
      byActor.set(row.actor, [...(byActor.get(row.actor) ?? []), { detail: row.detail }]);
    } else if (row.action === "written_off" && Number.isFinite(amount)) {
      writtenOff += amount;
    } else if (row.action === "discounted" && Number.isFinite(amount)) {
      discounted += amount;
    }
  }

  const people = [...byActor.entries()]
    .map(([actor, lines]) => ({ actor, ...tillFrom(lines) }))
    .sort((a, b) => b.total - a.total);

  return {
    people,
    totals: tillFrom([...byActor.values()].flat()),
    writtenOff: round2(writtenOff),
    discounted: round2(discounted),
  };
}

