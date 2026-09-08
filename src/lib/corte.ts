import { parseLogDetail } from "@/lib/log-detail";
import { EMPTY_TILL, tillFrom, type PaymentLine, type Till } from "@/lib/till";
import { round2 } from "@/lib/money";

/**
 * The register close — a "corte de caja".
 *
 * At the end of a day or a shift somebody counts the drawer against what the
 * system says was taken. That is a per-person question, not a per-restaurant
 * one: each till is counted by the person who filled it, and a single day
 * total cannot tell you which drawer is short.
 *
 * So this groups the day's payments by who took them, splits cash from card —
 * only cash has to physically match — and states separately what never
 * arrived: bills written off and discounts given. A corte that shows only what
 * came in cannot be reconciled against a night where somebody walked out.
 *
 * It reads from two places, because they are two different facts. Money that
 * ARRIVED is `payments`, where the amount is a number and the method is one of
 * two words the database constrains. Money that never arrived cannot be in a
 * payments table at all, so write-offs and discounts still come from the
 * activity log, which is where the decision to forgo them was recorded.
 *
 * It will not always match the revenue tiles beside it, and that is correct.
 * The tiles count orders CREATED in the period; a corte counts money RECORDED
 * during the shift. A table that ordered at 23:50 and settled at 00:05 belongs
 * to yesterday's sales and to today's drawer — which is exactly what the person
 * counting that drawer needs it to do.
 */

/** A row of `payments`, with the staff member who took it. */
export interface CortePayment extends PaymentLine {
  actor_email: string | null;
}

/** A row of the activity log describing money that was given up. */
export interface CorteAdjustment {
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
  /** Everything collected by a person, by everyone. The drawers, summed. */
  totals: Till;
  /**
   * Card money a diner paid online, which belongs to no drawer and so is shown
   * apart from the total anybody counts. The activity log never knew about it:
   * nobody was standing there to record it, so a night's real takings were
   * invisible to the one document that closes the night.
   */
  online: number;
  /** Served and never charged for. Not revenue, and not in the drawer. */
  writtenOff: number;
  /** Taken off bills as promotions. Also money that did not arrive. */
  discounted: number;
}

export const EMPTY_CORTE: Corte = {
  people: [],
  totals: EMPTY_TILL,
  online: 0,
  writtenOff: 0,
  discounted: 0,
};

export function corteFrom(
  payments: CortePayment[],
  adjustments: CorteAdjustment[] = [],
): Corte {
  const byActor = new Map<string, PaymentLine[]>();
  let online = 0;

  for (const payment of payments) {
    // Nobody was holding a till, so this is not anybody's drawer to count.
    if (!payment.actor_email) {
      const amount = Number(payment.amount);
      if (Number.isFinite(amount)) online += amount;
      continue;
    }
    const lines = byActor.get(payment.actor_email) ?? [];
    lines.push({ amount: payment.amount, method: payment.method });
    byActor.set(payment.actor_email, lines);
  }

  let writtenOff = 0;
  let discounted = 0;
  for (const row of adjustments) {
    const amount = Number(parseLogDetail(row.detail)?.amount);
    if (!Number.isFinite(amount)) continue;
    if (row.action === "written_off") writtenOff += amount;
    else if (row.action === "discounted") discounted += amount;
  }

  const people = [...byActor.entries()]
    .map(([actor, lines]) => ({ actor, ...tillFrom(lines) }))
    .sort((a, b) => b.total - a.total);

  return {
    people,
    totals: tillFrom([...byActor.values()].flat()),
    online: round2(online),
    writtenOff: round2(writtenOff),
    discounted: round2(discounted),
  };
}
