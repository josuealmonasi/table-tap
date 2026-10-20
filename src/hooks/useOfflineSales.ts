"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { useRouter } from "next/navigation";
import { queueAcknowledgement } from "@/lib/offline-review";
import { dropHeld, keepAcknowledgement, saleAcknowledgement, holdSale, markHeldError, readHeld, replayBody, type HeldSale } from "@/lib/offline-sales";

/** How often held sales are tried again while the till is online. */
const RETRY_MS = 30_000;

/**
 * The till's connection, and the sales it is holding for this restaurant.
 *
 * Held sales are sent the moment the connection returns, one at a time in the
 * order they happened, and then every half minute while any are left. A sale
 * the server accepts is dropped from the device; one safely queued for manager
 * review can also leave the device. A refusal is kept with the reason, for a
 * manager to see — it is never thrown away, because it is
 * the only record of money already taken.
 */
export function useOfflineSales(restaurantId: string, uploadOnly = false) {
  const router = useRouter();
  const t = useT();
  const [online, setOnline] = useState(true);
  const [held, setHeld] = useState<HeldSale[]>([]);
  const sending = useRef(false);

  const refresh = useCallback(() => setHeld(readHeld().filter(s => s.restaurantId === restaurantId)), [restaurantId]);

  const flush = useCallback(async () => {
    if (sending.current || !navigator.onLine) return;
    sending.current = true;
    let sent = 0;
    try {
      for (const sale of readHeld().filter(s => s.restaurantId === restaurantId).sort((a, b) => a.at.localeCompare(b.at))) {
        let res: Response;
        try {
          res = await fetch(uploadOnly ? "/api/pos/upload" : "/api/pos/order", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(replayBody(sale)),
          });
        } catch {
          break; // still no connection: try again later, in the same order
        }
        const data = await res.json().catch(() => null);
        const acknowledgement = saleAcknowledgement(sale, data);
        if (res.ok && (acknowledgement === "settled" || queueAcknowledgement(replayBody(sale), data))) {
          if (dropHeld(sale.posRef, restaurantId)) sent++;
        } else {
          if (res.ok && acknowledgement === "mismatch") keepAcknowledgement(sale, data);
          const reason = res.ok
            ? t(acknowledgement === "mismatch" ? "pos.saleMismatch" : "pos.saleUnsettled", { collected: sale.charge.total, settled: data?.total ?? "—" })
            : typeof data?.error === "string" ? data.error : `HTTP ${res.status}`;
          markHeldError(sale.posRef, restaurantId, reason);
        }
      }
    } finally {
      sending.current = false;
      refresh();
      if (sent > 0) router.refresh();
    }
  }, [restaurantId, refresh, router, t, uploadOnly]);

  useEffect(() => {
    refresh();
    setOnline(navigator.onLine);
    const up = () => {
      setOnline(true);
      void flush();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    void flush();
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [refresh, flush]);

  useEffect(() => {
    if (held.length === 0) return;
    const timer = setInterval(() => void flush(), RETRY_MS);
    return () => clearInterval(timer);
  }, [held.length, flush]);

  /** Keeps a sale on the device; false when the browser would not store it. */
  const hold = useCallback((sale: HeldSale): boolean => {
    const kept = holdSale(sale);
    refresh();
    return kept;
  }, [refresh]);

  const acknowledge = useCallback((sale: HeldSale, data: unknown): boolean => {
    const result = saleAcknowledgement(sale, data);
    if (result !== "settled") {
      if (result === "mismatch") keepAcknowledgement(sale, data);
      const total = (data as { total?: unknown } | null)?.total;
      markHeldError(sale.posRef, restaurantId, t(result === "mismatch" ? "pos.saleMismatch" : "pos.saleUnsettled", { collected: sale.charge.total, settled: typeof total === "number" ? total : "—" }));
      refresh();
      return false;
    }
    const removed = dropHeld(sale.posRef, restaurantId);
    refresh();
    return removed;
  }, [restaurantId, refresh, t]);

  /** A sale the server refused outright: it did not happen, so nothing is held. */
  const discard = useCallback((sale: HeldSale): void => {
    dropHeld(sale.posRef, restaurantId);
    refresh();
  }, [restaurantId, refresh]);

  return { online, held, hold, acknowledge, discard, flush, setOnline };
}
