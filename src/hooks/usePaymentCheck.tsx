"use client";

import { useEffect, useState } from "react";
import CheckPayment from "@/components/dashboard/CheckPayment";
import type { PaymentCheckScope } from "@/lib/payment-check";

/** Save the refused scope before a selection, currency or account can change. */
export function usePaymentCheck(onRefresh: () => void | Promise<void>, resetKey = "") {
  const [refusal, setRefusal] = useState<{ scope: PaymentCheckScope; key: number } | null>(null);
  useEffect(() => setRefusal(null), [resetKey]);
  function capture(data: { checkoutCode?: unknown }, scope: PaymentCheckScope): void {
    setRefusal(previous => data.checkoutCode === "checkout_unresolved"
      ? { scope: structuredClone(scope), key: (previous?.key ?? 0) + 1 } : null);
  }
  return { capture, action: refusal ? <CheckPayment key={refusal.key} scope={refusal.scope} onRefresh={onRefresh} /> : null };
}
