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
import { LIVE_FLOW } from "@/lib/order-flow";

const KEY = "tt-offline-queue";

export interface QueuedMove {
  id: string;
  /** What it was when the person moved it — the server checks this. */
  from: OrderStatus;
  to: OrderStatus;
  /** When they moved it, for showing how long the board has been waiting. */
  at: number;
}

/** Keep each step: the server only accepts a live stage's next step or undo. */
export function enqueue(queue: QueuedMove[], move: QueuedMove): QueuedMove[] {
  return move.from === move.to ? queue : [...queue, ...forwardSteps(move)];
}

/** Old clients saved one jump for several taps. Replay its permitted steps. */
function forwardSteps(move: QueuedMove): QueuedMove[] {
  const flow: OrderStatus[] = [...LIVE_FLOW, "completed"];
  const from = flow.indexOf(move.from);
  const to = flow.indexOf(move.to);
  if (from < 0 || to <= from + 1) return [move];
  return flow.slice(from, to).map((stage, i) => ({ ...move, from: stage, to: flow[from + i + 1] }));
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
    ).flatMap(forwardSteps);
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
