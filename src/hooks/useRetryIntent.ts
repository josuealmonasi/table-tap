"use client";

import { useRef, useState } from "react";

export interface RetryIntent {
  body(value: object): string;
  frozen<T extends object>(): T | null;
  clear(): void;
  pending(): boolean;
  /** Whether this refusal settles the attempt, so its reference may go. */
  settles(status: number): boolean;
  /**
   * Whether to say the request was not confirmed. Not while its first send
   * is still on its way: the saved request exists from the moment it goes
   * out, and «Este pedido no se confirmó» over a «Guardando…» read as an
   * order that had failed while it was being placed. Only once a send ended
   * without an answer, and through the retries after it.
   */
  unconfirmed(): boolean;
  /** Whether a send of the saved request is still on its way. */
  sending(): boolean;
  /**
   * The send `body()` started has its answer, or none. Called from the
   * sender's `finally`. Kept here, beside the request, so a form closed and
   * reopened mid-send knows it is still sending (cross-review of batch 5).
   */
  ended(): void;
}

/** A lost reply must retry the exact request, even if the form changed. */
export function useRetryIntent(): RetryIntent {
  const saved = useRef<string | null>(null);
  // How many times the saved request has gone out. One means this answer is
  // to the only request that has ever carried the reference.
  const sends = useRef(0);
  const outstanding = useRef(false);
  const [, refresh] = useState(0);
  return {
    body(value: object): string {
      if (saved.current === null) {
        saved.current = JSON.stringify({ ...value, ref: crypto.randomUUID() });
        sends.current = 0;
        refresh(n => n + 1);
      }
      sends.current++;
      outstanding.current = true;
      return saved.current;
    },
    frozen<T extends object>(): T | null { return saved.current === null ? null : JSON.parse(saved.current) as T; },
    clear(): void { saved.current = null; sends.current = 0; refresh(n => n + 1); },
    pending(): boolean { return saved.current !== null; },
    settles(status: number): boolean {
      return refusalSettles(status, sends.current > 1);
    },
    unconfirmed(): boolean {
      return saved.current !== null && (sends.current > 1 || !outstanding.current);
    },
    sending(): boolean { return outstanding.current; },
    ended(): void {
      if (!outstanding.current) return;
      outstanding.current = false;
      refresh(n => n + 1);
    },
  };
}

/**
 * Whether a refusal settles the attempt, so its reference may go. Keeping a
 * reference is always safe; dropping it early is what duplicates.
 *
 * The first send of a fresh reference is the only request that has ever
 * carried it, so any refusal settles it: a sold-out dish, a closed kitchen, a
 * frozen plan. Kept, the person sat on "send again" with a cart that could
 * never go. Only a timeout (408, 425) can arrive while the work goes on.
 *
 * A retry follows a reply that was lost, and no refusal settles it. The first
 * request may already have committed, or may still be on its way: delayed
 * before the writer's lock, it can commit after the retry was refused there.
 * Cleared on a 429 or a frozen plan's 402, a lost MX$100 order was created
 * again under a new reference (audit L, finding 5); cleared on a route's or
 * even the writer's own refusal, the same (cross-reviews of batch 5). The
 * person lets it go deliberately, after checking (`pending.discard`).
 */
export function refusalSettles(status: number, retried = false): boolean {
  if (status < 400 || status >= 500 || [408, 425].includes(status)) return false;
  return !retried;
}
