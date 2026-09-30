// ============================================================================
// Customer accounts — the rules that need no database.
//
// An account is credit a restaurant extends to a customer it knows: the food
// goes out now and is paid for in one go, later. Its statement is the list of
// what is owed, day by day, and its key is a random code on a QR — the visit
// card's alphabet, so `normalizeCode` and `formatCode` read both.
// ============================================================================

import { localDayKey } from "@/lib/day-window";
import { round2 } from "@/lib/money";

export { formatCode, newCode, normalizeCode } from "@/lib/loyalty/code";

/** The most an account may be trusted with, whatever a person types. */
export const MAX_CREDIT_LIMIT = 1_000_000;
export const MAX_NAME = 80;

/** Where an account's QR points: its statement. */
export function accountLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/cuenta/${code}`;
}

/** A name for the account, trimmed, or null when there is none worth keeping. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim();
  return name.length > 0 && name.length <= MAX_NAME ? name : null;
}

/** An email to send the statement to: optional, and only one that looks like one. */
export function cleanEmail(raw: unknown): string | null | "bad" {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") return "bad";
  const email = raw.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "bad";
}

/** A ceiling in money: positive, two decimals, below the house maximum. */
export function cleanLimit(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const limit = Math.round(n * 100) / 100;
  return limit > 0 && limit <= MAX_CREDIT_LIMIT ? limit : null;
}

/** One line of an order, as the statement shows it. */
export interface StatementLine {
  name: string;
  emoji: string | null;
  qty: number;
  /** What the line cost, extras included. */
  amount: number;
  extras: string[];
}

/** One order put on the account. */
export interface StatementCharge {
  orderId: string;
  /** When it was charged (the order's time if it was charged at once). */
  at: string;
  tableLabel: string | null;
  lines: StatementLine[];
  total: number;
}

/** A day of charges, in the restaurant's own time zone. */
export interface StatementDay {
  day: string;
  charges: StatementCharge[];
  total: number;
}


/**
 * Charges by the restaurant's calendar day, oldest first — the order a
 * customer checks a tab in. A dinner at 11pm belongs to that night, not to the
 * next day, wherever the server happens to be.
 */
export function byDay(charges: StatementCharge[], timeZone: string): StatementDay[] {
  const days = new Map<string, StatementCharge[]>();
  for (const charge of [...charges].sort((a, b) => a.at.localeCompare(b.at))) {
    const day = localDayKey(new Date(charge.at), timeZone);
    days.set(day, [...(days.get(day) ?? []), charge]);
  }
  return [...days].map(([day, list]) => ({
    day,
    charges: list,
    total: round2(list.reduce((sum, c) => sum + c.total, 0)),
  }));
}

interface StoredLine {
  name?: unknown;
  emoji?: unknown;
  qty?: unknown;
  price?: unknown;
  extras?: { name?: unknown; price?: unknown }[];
}

/** An order's stored items as statement lines. */
export function linesOf(items: unknown): StatementLine[] {
  if (!Array.isArray(items)) return [];
  return (items as StoredLine[]).map(line => {
    const qty = Number(line.qty) > 0 ? Number(line.qty) : 1;
    const extras = Array.isArray(line.extras) ? line.extras : [];
    const each = Number(line.price ?? 0) + extras.reduce((sum, e) => sum + Number(e.price ?? 0), 0);
    return {
      name: String(line.name ?? ""),
      emoji: typeof line.emoji === "string" ? line.emoji : null,
      qty,
      amount: round2(each * qty),
      extras: extras.map(e => String(e.name ?? "")).filter(Boolean),
    };
  });
}

/** How much room is left under the ceiling. */
export function headroom(owed: number, limit: number): number {
  return Math.max(0, round2(limit - owed));
}
