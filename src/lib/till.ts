import { parseLogDetail } from "@/lib/log-detail";
import { round2 } from "@/lib/money";

/**
 * What one person has collected during the restaurant's day.
 *
 * A cashier could take money all shift and had no way to count it: the "taken
 * today" figure on the orders board is the whole restaurant's and is shown to
 * management only, and the activity log — which records every settlement with
 * who, how much and by what method — is readable by the owner alone. So the
 * person holding the cash was the one person who could not say what should be
 * in the drawer.
 *
 * This is deliberately their OWN total and not the restaurant's. A waiter
 * counting their takings does not need the day's revenue, and a till that
 * reports somebody else's collections is not a till.
 *
 * Pure, so the arithmetic is testable without a database.
 */
export interface TillLine {
  detail: string | null;
}

export interface Till {
  /** How many settlements they recorded. */
  count: number;
  /** Everything they took, whatever the method. */
  total: number;
  /** Cash, which is the part that has to physically match. */
  cash: number;
  /** Card taken at the till — recorded here, but not in the drawer. */
  card: number;
}

export const EMPTY_TILL: Till = { count: 0, total: 0, cash: 0, card: 0 };

/**
 * Adds up settlement rows from the activity log.
 *
 * A row whose amount will not parse is counted as a settlement but adds
 * nothing: dropping it entirely would quietly disagree with the log the
 * manager reads, and inventing a number would be worse.
 */
export function tillFrom(rows: TillLine[]): Till {
  const till = { ...EMPTY_TILL };
  for (const row of rows) {
    till.count += 1;
    const fields = parseLogDetail(row.detail);
    const amount = Number(fields?.amount);
    if (!Number.isFinite(amount)) continue;
    till.total += amount;
    if (fields?.method === "cash") till.cash += amount;
    else if (fields?.method === "card") till.card += amount;
  }
  return {
    count: till.count,
    total: round2(till.total),
    cash: round2(till.cash),
    card: round2(till.card),
  };
}

