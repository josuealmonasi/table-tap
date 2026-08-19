"use client";

import { useCallback, useEffect, useState } from "react";
import { myOrderIds } from "@/lib/my-orders";
import { recallSitting } from "@/lib/table-binding";
import { tableBill, type TableBill } from "@/lib/table-bill";
import type { Order } from "@/lib/types";

/**
 * What the table owes, kept roughly current while the diners sit there.
 *
 * Orders are unreadable to customers, so this goes through /api/bill rather
 * than the database. It refreshes when the diner returns to the tab — the
 * moment they are most likely to be about to settle, and the moment someone
 * else at the table may have added to it.
 */
export function useTableBill(
  restaurantId: string,
  tableId: string | null,
  /** True while the diner is looking at the bill, which is when it must be live. */
  watching = false,
): { bill: TableBill | null; loading: boolean; reload: () => void } {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    if (!tableId) return;
    setLoading(true);
    // Our own sitting, so a bill we opened stays ours to settle.
    const sitting = recallSitting(restaurantId);
    const mine = sitting?.tableId === tableId ? `&sessionId=${sitting.sessionId}` : "";
    fetch(`/api/bill?restaurantId=${restaurantId}&tableId=${tableId}${mine}`)
      .then(r => (r.ok ? r.json() : { orders: [] }))
      .then(d => setOrders(d.orders ?? []))
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, [restaurantId, tableId]);

  useEffect(() => {
    reload();
    const onVisible = () => {
      if (document.visibilityState === "visible") reload();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    // While the bill is open on screen, poll: a manager can apply a promotion
    // to it from their side, and the diner should watch the amount drop rather
    // than be told about it. Ten seconds is well inside the endpoint's own
    // limit and costs one small query per diner sitting on the screen.
    const tick = watching ? setInterval(reload, 10_000) : null;

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (tick) clearInterval(tick);
    };
  }, [reload, watching]);

  return {
    // Which of these are "mine" is read at render: the phone may have placed an
    // order since the last fetch.
    bill: orders ? tableBill(orders, myOrderIds(restaurantId)) : null,
    loading,
    reload,
  };
}
