"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { useT } from "@/lib/i18n/context";
import { SPLIT_POLL_MS } from "@/lib/poll";

/** What the table is doing about its bill, from this phone's point of view. */
export interface SplitState {
  modelVersion?: number; revision?: number; currency?: string; frozen?: boolean; slots?: import("@/lib/split-slots").SplitSlot[];
  resumptions?: import("@/lib/split-slots").SplitResumption[];
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
  quote?: { expectedCents: number; currency: string },
): {
  split: SplitState | null;
  diner: string;
  busy: boolean;
  error: string | null;
  propose: (shares: number) => Promise<void>;
  join: () => Promise<void>;
  cancel: () => Promise<void>;
  ready: boolean;
  refresh: () => Promise<void>;
  resize: (people: number) => Promise<void>;
} {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = useRef<{ key: string; ref: string } | null>(null);
  const sending = useRef(false);
  const key = active && tableId && sessionId
    ? `/api/split?sessionId=${sessionId}&restaurantId=${restaurantId}&tableId=${tableId}&own=${encodeURIComponent(ownOrderIds.join(","))}` : null;
  const { data, error: readError, mutate } = useSWR<{ split: SplitState | null; diner: string }>(key, async url => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error ?? t("slots.readFailed"));
      // A confirmed empty bill ends the old start; a failed read cannot do that.
      if (!sending.current && result.split === null) start.current = null;
      return result;
    } catch { throw new Error(t("slots.readFailed")); }
  }, { refreshInterval: SPLIT_POLL_MS });
  const split = data?.split ?? null;
  const diner = data?.diner ?? "";
  async function read(): Promise<void> {
    const fresh = await mutate();
    if (fresh?.split === null) start.current = null;
  }

  async function send(path: string, method: string, body: Record<string, unknown>): Promise<void> {
    if (!tableId || !sessionId || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method, headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, diner, restaurantId, tableId, ...body }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) setError(result.error ?? t("apiErr.generic"));
      // Cancellation is final even when Wi-Fi loses the following read.
      else if (path === "/api/split/cancel" || method === "DELETE") start.current = null;
      // Offline for a moment: keep showing what we last knew.
      // A refusal can mean another phone took a part, so read the current list too.
      await read();
    } catch { setError(t("done.networkError")); }
    finally { sending.current = false; setBusy(false); }
  }
  function propose(shares: number): Promise<void> {
    if (sending.current) return Promise.resolve();
    const request = JSON.stringify({ restaurantId, tableId, sessionId, shares, ...quote });
    // The same start after a lost reply must find its split, not create another.
    if (start.current?.key !== request) start.current = { key: request, ref: splitStartRef() };
    return send("/api/split/start", "POST", { shares, ...quote, ref: start.current.ref });
  }

  return {
    split,
    diner,
    busy,
    error: error ?? (readError ? t("slots.readFailed") : null),
    ready: Boolean(data) && !readError,
    propose,
    join: () => send("/api/split/join", "POST", { splitId: split?.id }),
    cancel: () => split?.modelVersion === 2
      ? send("/api/split/cancel", "POST", { splitId: split.id, revision: split.revision })
      : send("/api/split", "DELETE", { splitId: split?.id }),
    resize: (shares: number) => send("/api/split/resize", "POST", { splitId: split?.id, revision: split?.revision, shares }),
    refresh: read,
  };
}

/** Local Wi-Fi can be plain HTTP: getRandomValues still gives a UUID there. */
function splitStartRef(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
