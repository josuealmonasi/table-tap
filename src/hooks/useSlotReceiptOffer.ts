"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BILL_POLL_MS } from "@/lib/poll";
import type { SplitScope } from "@/lib/split-slots";
import { SLOT_SETTLING, readReceiptMemory, writeReceiptMemory, type PendingSlotReceipt, type SlotReceiptTarget } from "@/lib/slot-receipt-offer";

/** Keep receipt polling separate from whether the bill sheet is still open. */
export function useSlotReceiptOffer(scope?: SplitScope) {
  const restaurantId = scope?.restaurantId, tableId = scope?.tableId, sessionId = scope?.sessionId;
  const [queue, setQueue] = useState<string[]>([]);
  const current = useRef({ key: "", ids: [] as string[] });
  const [paidNow, setPaidNow] = useState(false);
  const [split, setSplit] = useState(false);
  const [splitOrderIds, setSplitOrderIds] = useState<string[] | null>(null);
  useEffect(() => {
    setPaidNow(false); setSplit(false); setSplitOrderIds(null);
    const key = restaurantId && tableId && sessionId ? `tt.receipt.slots:${restaurantId}:${tableId}:${sessionId}` : "";
    if (current.current.key !== key) {
      const waiting = readReceiptMemory<string[]>(`${key}:queue`, []);
      current.current = { key, ids: Array.isArray(waiting) ? waiting : [] };
    }
    setQueue(current.current.ids);
    if (!restaurantId || !tableId || !sessionId) return;
    writeReceiptMemory(`${key}:queue`, current.current.ids.slice(1));
    const params = new URLSearchParams({ restaurantId, tableId, sessionId });
    const remembered = readReceiptMemory<string[] | null>(`${key}:seen`, null);
    let seen = Array.isArray(remembered) ? remembered : null;
    const saved = readReceiptMemory<PendingSlotReceipt | null>(SLOT_SETTLING, null);
    let pending = new URLSearchParams(window.location.search).get("settled") === "1"
      && saved?.restaurantId === restaurantId && saved.tableId === tableId && saved.sessionId === sessionId
      && Array.isArray(saved.slots) ? saved : null;
    let stopped = false, busy = false;
    async function reload(): Promise<void> {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const response = await fetch(`/api/receipt/payments?${params}`);
        if (!response.ok) return;
        const data = await response.json() as { payments: SlotReceiptTarget[]; split: boolean; splitOrderIds: string[] };
        if (stopped || !Array.isArray(data.payments) || !Array.isArray(data.splitOrderIds)) return;
        setSplit(data.split); setSplitOrderIds(data.splitOrderIds);
        const ids = data.payments.map(p => p.paymentId);
        const returned = pending ? data.payments.find(p => p.splitId === pending!.splitId
          && pending!.slots.length === p.slots.length && pending!.slots.every(n => p.slots.includes(n))) : null;
        const asked = readReceiptMemory<string[]>(`${key}:asked`, []);
        const fresh = [...new Set([...(returned ? [returned.paymentId] : []), ...ids.filter(id => seen !== null && !seen.includes(id))])]
          .filter(id => !asked.includes(id));
        seen = ids; writeReceiptMemory(`${key}:seen`, ids);
        if (returned) { pending = null; writeReceiptMemory(SLOT_SETTLING, null); }
        if (fresh.length) {
          // Keep the unshown queue across refreshes; the visible receipt was already offered.
          writeReceiptMemory(`${key}:asked`, [...asked, ...fresh]);
          current.current.ids = [...current.current.ids, ...fresh];
          writeReceiptMemory(`${key}:queue`, current.current.ids.slice(1));
          setQueue(current.current.ids); setPaidNow(true);
        }
      } catch {
        // A failed read is not a payment and cannot replace the last known bill.
      } finally { busy = false; }
    }
    void reload();
    const visible = () => { void reload(); };
    const tick = setInterval(visible, BILL_POLL_MS);
    window.addEventListener("focus", visible); document.addEventListener("visibilitychange", visible);
    return () => { stopped = true; clearInterval(tick); window.removeEventListener("focus", visible); document.removeEventListener("visibilitychange", visible); };
  }, [restaurantId, tableId, sessionId]);
  const dismiss = useCallback(() => {
    current.current.ids = current.current.ids.slice(1);
    writeReceiptMemory(`${current.current.key}:queue`, current.current.ids.slice(1));
    setQueue(current.current.ids);
  }, []);
  return { paymentId: queue[0] ?? null, dismiss, paidNow, split, splitOrderIds: restaurantId && tableId && sessionId ? splitOrderIds : [] };
}
