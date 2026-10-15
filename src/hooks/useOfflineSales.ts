"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { dropHeld, holdSale, markHeldError, readHeld, replayBody, type HeldSale } from "@/lib/offline-sales";

/** How often held sales are tried again while the till is online. */
const RETRY_MS = 30_000;

/**
 * The till's connection, and the sales it is holding for this restaurant.
 *
 * Held sales are sent the moment the connection returns, one at a time in the
 * order they happened, and then every half minute while any are left. A sale
 * the server accepts is dropped from the device; one it refuses is kept with
 * the reason, for a manager to see — it is never thrown away, because it is
 * the only record of money already taken.
 */
export function useOfflineSales(restaurantId: string) {
  const router = useRouter();
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
          res = await fetch("/api/pos/order", {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(replayBody(sale)),
          });
        } catch {
          break; // still no connection: try again later, in the same order
        }
        if (res.ok) {
          dropHeld(sale.posRef);
          sent++;
        } else {
          const data = await res.json().catch(() => ({}));
          markHeldError(sale.posRef, typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
        }
      }
    } finally {
      sending.current = false;
      refresh();
      if (sent > 0) router.refresh();
    }
  }, [restaurantId, refresh, router]);

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

  return { online, held, hold, flush, setOnline };
}
