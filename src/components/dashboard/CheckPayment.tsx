"use client";

import { useRef, useState, type JSX } from "react";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { isPaymentCheckOutcome, type PaymentCheckOutcome, type PaymentCheckScope } from "@/lib/payment-check";

interface Props { scope: PaymentCheckScope; onRefresh: () => void | Promise<void> }

/** A refusal offers a check, never a disguised retry of the money action. */
export default function CheckPayment({ scope, onRefresh }: Props): JSX.Element {
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<PaymentCheckOutcome | null>(null);
  const sending = useRef(false);
  async function check(): Promise<void> {
    if (sending.current) return;
    sending.current = true; setBusy(true);
    let result: PaymentCheckOutcome = "unverified";
    try {
      const res = await fetch("/api/checkout/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scope) });
      const data = await res.json();
      if (res.ok && isPaymentCheckOutcome(data.outcome)) result = data.outcome;
    } catch { /* An unreadable answer cannot prove the customer was not charged. */ }
    try { await onRefresh(); } catch {
      // A failed balance read cannot erase positive proof the customer paid.
      if (result === "closed") result = "unverified";
    }
    setOutcome(result);
    // Refreshing can replace this row or dialog. The answer must survive it.
    toast(t(`paymentCheck.${result}`));
    sending.current = false; setBusy(false);
  }
  return <div data-payment-check>
    <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" disabled={busy} onClick={check}>
      {t(busy ? "paymentCheck.checking" : "paymentCheck.action")}
    </button>
    {outcome && <p role="status" className="tt-muted">{t(`paymentCheck.${outcome}`)}</p>}
  </div>;
}
