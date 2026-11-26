"use client";

import { useEffect, useState } from "react";
import type { DiscountBillScope } from "@/lib/discount-bill";

/** A promotion the floor may apply to this bill, priced against it. */
export interface CouponOption {
  code: string;
  kind: "percent" | "fixed";
  value: number;
  amount: number;
  remaining: number | null;
}

/**
 * The promotions that would actually apply to this bill, from the server,
 * which reads the bill itself and judges it on the dishes — the floor
 * shouldn't have to remember codes, or leave the table to go and read the
 * promotions page. Asked for each time the dialog opens, and again when
 * `revision` (the bill's total) changes under it.
 */
export function useCouponOptions(open: boolean, bill: DiscountBillScope, revision = 0) {
  const [options, setOptions] = useState<CouponOption[]>([]);
  // The list arrives a moment after the dialog does. Its space is held from
  // the start: a modal that grows under a finger already on its way down is
  // how somebody applies a promotion they never chose.
  const [loading, setLoading] = useState(true);
  // The list could not be read. "Ninguna promoción coincide" in its place told
  // the waiter there was nothing to offer; a code can still be typed.
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setFailed(false);
    const query = new URLSearchParams();
    if (bill.tableId) query.set("tableId", bill.tableId);
    else if (bill.orderId) query.set("orderId", bill.orderId);
    if (bill.currency) query.set("currency", bill.currency);
    fetch(`/api/bill/discount/options?${query}`)
      .then(async r => {
        if (!r.ok) throw new Error(String(r.status));
        const d = await r.json();
        setOptions(d.options ?? []);
      })
      .catch(() => {
        setOptions([]);
        setFailed(true);
      })
      .finally(() => setLoading(false));
  }, [open, bill.tableId, bill.orderId, bill.currency, revision]);

  return { options, loading, failed };
}
