import { round2 } from "@/lib/money";

/**
 * The cash drawer through one day: what it started with, the cash taken, and
 * what was taken out — so the register close can say what it should hold.
 *
 * Asked for by a restaurant: "if we start the day with 250 pesos, the close is
 * the opening plus what was sold, and a withdrawal has to be recorded." Only
 * cash has a float. Card and online money never sits in a drawer, so neither
 * starts anywhere or is taken out of one.
 *
 * Pure. The rows come from `cash_movements`, the cash from the corte.
 */

export const MAX_CASH_AMOUNT = 1_000_000;

/** A row of `cash_movements`. */
export interface CashMovement {
  id: string;
  kind: "opening" | "withdrawal";
  amount: number;
  note: string | null;
  actor_email: string;
  created_at: string;
}

export interface Drawer {
  /** What the day started with: the latest opening set today, or nothing. */
  opening: number;
  /** Whether anybody set one today. A drawer that starts at 0 says so too. */
  openingSet: boolean;
  /** Cash taken today, net of cash handed back — the corte's cash column. */
  cashSales: number;
  /** Taken out of the drawer today, oldest first. */
  withdrawals: CashMovement[];
  withdrawn: number;
  /** What should be in the drawer now: opening + cash sales − withdrawals. */
  expected: number;
}

export const EMPTY_DRAWER: Drawer = {
  opening: 0,
  openingSet: false,
  cashSales: 0,
  withdrawals: [],
  withdrawn: 0,
  expected: 0,
};

/** The drawer for a day, from its movements and the cash the corte counted. */
export function drawerFrom(movements: CashMovement[], cashSales: number): Drawer {
  const byTime = [...movements].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const openings = byTime.filter(m => m.kind === "opening");
  const withdrawals = byTime.filter(m => m.kind === "withdrawal");
  const opening = round2(Number(openings.at(-1)?.amount ?? 0));
  const withdrawn = round2(withdrawals.reduce((sum, m) => sum + Number(m.amount), 0));
  const cash = round2(cashSales);
  return {
    opening,
    openingSet: openings.length > 0,
    cashSales: cash,
    withdrawals,
    withdrawn,
    expected: round2(opening + cash - withdrawn),
  };
}

/**
 * A typed amount of cash, or null when it is not one. Accepts "250", "250.5"
 * and "1,250.00"; refuses a negative, more than two decimals, or more than
 * any drawer holds. A withdrawal of nothing is not one, so `positive` refuses 0.
 */
export function cashAmount(raw: unknown, positive: boolean): number | null {
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim().replace(/,/g, "") : "";
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text);
  if (!Number.isFinite(amount) || amount > MAX_CASH_AMOUNT) return null;
  if (positive && amount <= 0) return null;
  return round2(amount);
}

/** A withdrawal's reason: trimmed, at most 140 characters, or nothing. */
export function cashNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const note = raw.trim().slice(0, 140);
  return note || null;
}
