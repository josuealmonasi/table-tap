"use client";

import { useState, type JSX } from "react";
import type { CollectedSlotReceipt } from "@/hooks/useStaffSlotReceipts";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/format";
import { printableReceipt } from "@/lib/print-document";
import { printWhenReady } from "@/lib/print-window";

interface Props { receipts: CollectedSlotReceipt[] }

/** A part's paper names its payment; an order id would print the whole bill. */
export default function SlotReceiptPrints({ receipts }: Props): JSX.Element | null {
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function print(paymentId: string): Promise<void> {
    if (busy) return;
    // Open during the tap so phones do not block the window after the fetch.
    const popup = window.open("", "_blank", "width=380,height=640");
    if (!popup) { toast(t("pos.printBlocked"), "error"); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/orders/print", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ paymentId, to: "receipt" }),
      });
      const data = await response.json();
      if (!response.ok || typeof data.html !== "string") throw new Error(data.error ?? t("done.networkError"));
      popup.document.write(printableReceipt(data.html, t("slots.printPart")));
      popup.document.close(); popup.focus(); printWhenReady(popup);
    } catch (error) {
      popup.close();
      toast(error instanceof Error ? error.message : t("done.networkError"), "error");
    } finally { setBusy(false); }
  }
  if (!receipts.length) return null;
  return <div className="tt-bill-actions">
    {receipts.map(receipt => <button key={receipt.paymentId} type="button" className="tt-btn tt-btn-ghost"
      data-slot-receipt-print disabled={busy} onClick={() => void print(receipt.paymentId)}>
      {t("slots.printPart")} · {formatMoney(receipt.amountCents / 100, receipt.currency)}
    </button>)}
  </div>;
}
