/**
 * Status moves made while the connection was gone.
 *
 * The kitchen board already moved an order optimistically and then fired the
 * PATCH without catching anything, so a tap made on a dropped connection showed
 * as applied and never reached the server. The ticket looked done to the person
 * who moved it and untouched to everyone else.
 *
 * Only status moves queue. A payment, a settlement or an approval never does:
 * replaying money is how the same table pays twice, so those refuse while
 * offline and say why.
 *
 * Each entry remembers the status it moved FROM. Work done on a dead connection
 * is older than work done on a live one, so the server applies a queued move
 * only if nothing has happened to the order since — a waiter's queued
 * "preparing" must not drag back an order the kitchen has already called ready.
 */
import type { OrderStatus } from "@/lib/types";

const KEY = "tt-offline-queue";

export interface QueuedMove {
  id: string;
  /** What it was when the person moved it — the server checks this. */
  from: OrderStatus;
  to: OrderStatus;
  /** When they moved it, for showing how long the board has been waiting. */
  at: number;
}

/**
 * Adds a move, or folds it into the one already waiting for that order.
 *
 * Three taps on one ticket while the wifi is out are one change to send: keep
 * the status it started at and the status it ended at, and drop the middle. A
 * queue that replays every tap makes the board flicker through states nobody
 * chose on the way to the one they did.
 */
export function enqueue(queue: QueuedMove[], move: QueuedMove): QueuedMove[] {
  const existing = queue.find(m => m.id === move.id);
  if (!existing) return [...queue, move];
  // Back where it started: there is nothing left to send.
  if (existing.from === move.to) return queue.filter(m => m.id !== move.id);
  return queue.map(m => (m.id === move.id ? { ...m, to: move.to, at: move.at } : m));
}

/** Reads the queue, tolerating a browser that will not give us storage. */
export function readQueue(): QueuedMove[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is QueuedMove =>
        typeof m === "object" && m !== null && typeof (m as QueuedMove).id === "string",
    );
  } catch {
    return [];
  }
}

/** Writes it back, and never throws: a full disk must not break the board. */
export function writeQueue(queue: QueuedMove[]): void {
  try {
    if (queue.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(queue));
  } catch {
    // A private window with storage denied still gets a working board; it just
    // cannot hold work across a reload, which is better than not loading.
  }
}
