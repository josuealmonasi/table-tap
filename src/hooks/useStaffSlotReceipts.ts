"use client";

import { useCallback, useEffect, useState } from "react";

export interface CollectedSlotReceipt { paymentId: string; amountCents: number; currency: string }

/** Keep the paper available after the last payment removes the live split. */
export function useStaffSlotReceipts(scope: string): {
  receipts: CollectedSlotReceipt[]; rememberReceipt: (receipt: CollectedSlotReceipt) => void;
} {
  const [receipts, setReceipts] = useState<CollectedSlotReceipt[]>([]);
  useEffect(() => { setReceipts([]); }, [scope]);
  const rememberReceipt = useCallback((receipt: CollectedSlotReceipt): void => {
    setReceipts(previous => previous.some(p => p.paymentId === receipt.paymentId) ? previous : [...previous, receipt]);
  }, []);
  return { receipts, rememberReceipt };
}
