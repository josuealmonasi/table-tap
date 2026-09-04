"use client";

import { useCallback, useEffect, useState } from "react";
import { dinerToken } from "@/lib/diner-token";

/** What the table is doing about its bill, from this phone's point of view. */
export interface SplitState {
  id: string;
  shares: number;
  status: "proposed" | "locked" | "cancelled" | "done";
  amount: number;
  proposedBy: string;
  joined: number;
  mine: { shareNo: number; amount: number; paid: boolean } | null;
  outstanding: number;
  ownSince: number;
}

/**
 * Whether this table is dividing its bill.
 *
 * Polled rather than subscribed, which is what the tracker does for the same
 * reason: a diner has no login, so a realtime channel would mean opening these
 * rows to anonymous readers. Every few seconds is fast enough for a decision
 * being made out loud across a table.
 */
export function useSplit(
  restaurantId: string,
  tableId: string | null,
  sessionId: string | null,
  active: boolean,
  /** This phone's own unpaid orders — what it would owe on top of its share. */
  ownOrderIds: string[] = [],
): {
  split: SplitState | null;
  diner: string;
  busy: boolean;
  propose: (shares: number) => Promise<void>;
  join: () => Promise<void>;
  cancel: () => Promise<void>;
  refresh: () => Promise<void>;
} {
  const [split, setSplit] = useState<SplitState | null>(null);
  const [busy, setBusy] = useState(false);
  const [diner, setDiner] = useState("");

  useEffect(() => {
    setDiner(dinerToken(restaurantId));
  }, [restaurantId]);

  const read = useCallback(async () => {
    if (!tableId || !sessionId || !diner) return;
    try {
      const res = await fetch(
        `/api/split?sessionId=${sessionId}&diner=${encodeURIComponent(diner)}` +
          `&restaurantId=${restaurantId}&tableId=${tableId}` +
          `&own=${encodeURIComponent(ownOrderIds.join(","))}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { split: SplitState | null };
      setSplit(data.split);
    } catch {
      // Offline for a moment: keep showing what we last knew.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, tableId, sessionId, diner, ownOrderIds.join(",")]);

  useEffect(() => {
    if (!active) return;
    read();
    const timer = setInterval(read, 5000);
    return () => clearInterval(timer);
  }, [active, read]);

  const send = useCallback(
    async (path: string, method: string, body: Record<string, unknown>) => {
      if (!tableId || !sessionId || !diner) return;
      setBusy(true);
      try {
        const res = await fetch(path, {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId, diner, restaurantId, tableId, ...body }),
        });
        const data = (await res.json().catch(() => ({}))) as { split?: SplitState | null };
        if (res.ok && "split" in data) setSplit(data.split ?? null);
        else await read();
      } finally {
        setBusy(false);
      }
    },
    [restaurantId, tableId, sessionId, diner, read],
  );

  return {
    split,
    diner,
    busy,
    propose: (shares: number) => send("/api/split", "POST", { shares }),
    join: () => send("/api/split/join", "POST", { splitId: split?.id }),
    cancel: () => send("/api/split", "DELETE", { splitId: split?.id }),
    refresh: read,
  };
}
