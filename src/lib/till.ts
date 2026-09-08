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
 * Counted from `payments`, where the amount is a number the database checked
 * and the method is one of two words it constrained. It used to be read out of
 * the activity log's `amount=120 method=cash` sentence, which meant the money a
 * cashier signs for was a substring: a row written a little differently added
 * nothing and still counted as a settlement, and nothing anywhere compared the
 * two records of the same night. `pnpm money` now does.
 *
 * Pure, so the arithmetic is testable without a database.
 */

/** A row of `payments`. Postgres hands `numeric` over as a string. */
export interface PaymentLine {
  amount: number | string;
  method: string;
}

export interface Till {
  /** How many payments they took. */
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
 * Adds up a person's payments.
 *
 * A row whose amount will not parse is counted as a payment but adds nothing.
 * The column is `numeric not null check (amount > 0)`, so this cannot happen
 * from the database side — it is kept because dropping the row entirely would
 * quietly disagree with the ledger the owner reads, and inventing a number
 * would be worse.
 */
export function tillFrom(payments: PaymentLine[]): Till {
  const till = { ...EMPTY_TILL };
  for (const payment of payments) {
    till.count += 1;
    const amount = Number(payment.amount);
    if (!Number.isFinite(amount)) continue;
    till.total += amount;
    if (payment.method === "cash") till.cash += amount;
    else if (payment.method === "card") till.card += amount;
  }
  return {
    count: till.count,
    total: round2(till.total),
    cash: round2(till.cash),
    card: round2(till.card),
  };
}
