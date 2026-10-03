"use client";

import { useEffect, useState } from "react";

/** A promotion the floor may apply to this bill, priced against it. */
export interface CouponOption {
  code: string;
  kind: "percent" | "fixed";
  value: number;
  amount: number;
  remaining: number | null;
}

/**
 * The promotions that would actually apply to a bill of `total`, from the
 * server — the floor shouldn't have to remember codes, or leave the table to
 * go and read the promotions page. Asked for each time the dialog opens.
 */
export function useCouponOptions(open: boolean, total: number) {
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
    fetch(`/api/bill/discount/options?total=${total}`)
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
  }, [open, total]);

  return { options, loading, failed };
}
