"use client";

import { useCallback, useEffect, useState } from "react";
import { myOrderIds } from "@/lib/my-orders";
import { recallSitting } from "@/lib/table-binding";
import { tableBill, type TableBill } from "@/lib/table-bill";
import type { Order } from "@/lib/types";
import { BILL_POLL_MS } from "@/lib/poll";

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
): {
  bill: TableBill | null;
  loading: boolean;
  reload: () => void;
  /** A waiter opened this bill and is settling it in person. */
  staffBill: boolean;
  /** How many devices have ordered on this table — the most ways its bill
   *  can be divided. */
  party: number;
  /** The table has frozen a split: it settles through the shares now. */
  dividing: boolean;
} {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [staffBill, setStaffBill] = useState(false);
  const [party, setParty] = useState(0);
  const [dividing, setDividing] = useState(false);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    if (!tableId) return;
    setLoading(true);
    // Our own sitting, so a bill we opened stays ours to settle.
    const sitting = recallSitting(restaurantId);
    const mine = sitting?.tableId === tableId ? `&sessionId=${sitting.sessionId}` : "";
    // A bill that could not be read keeps what was last known. It used to
    // become `{ orders: [] }`, and an empty bill is a settled one: one refused
    // poll hid the bill under a diner who owed it and asked them if they
    // wanted a receipt for paying it.
    fetch(`/api/bill?restaurantId=${restaurantId}&tableId=${tableId}${mine}`)
      .then(async r => {
        if (!r.ok) return;
        const d = await r.json();
        setOrders(d.orders ?? []);
        setStaffBill(Boolean(d.staffBill));
        setParty(Number(d.party) || 0);
        setDividing(Boolean(d.dividing));
      })
      .catch(() => {
        // Offline for a moment: the same, keep what we last knew.
      })
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
    // than be told about it. The route's limit is sized from this interval,
    // for every phone behind the room's address (see poll.ts).
    const tick = watching ? setInterval(reload, BILL_POLL_MS) : null;

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
    staffBill,
    party,
    dividing,
  };
}
