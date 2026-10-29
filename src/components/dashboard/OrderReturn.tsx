"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { mutate } from "swr";
import { useRetryIntent } from "@/hooks/useRetryIntent";
import { Modal } from "@/components/ui/Modal";
import PendingAttempt from "@/components/ui/PendingAttempt";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { receiptCents } from "@/lib/receipt-amount";
import { decimal } from "@/lib/costs/input";
import { orderCode, type Order } from "@/lib/types";

interface Props { order: Order; onPrepared: () => Promise<void> }
interface Request { action: "prepare"; orderId: string; amountCents: number; reason: string;
  expected: { totalCents: number; tipCents: number; serviceCents: number } }

/** The request lives outside the modal. Closing a lost reply must not create
 * another reference when the manager opens the same return again. */
export default function OrderReturn({ order, onPrepared }: Props) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const attempt = useRetryIntent();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const frozen = attempt.frozen<Request>();
  const pending = Boolean(frozen);
  const value = decimal(amount, Number(order.total), 2);
  const amountCents = value === null ? 0 : receiptCents(value);
  const eligible = order.paid && order.status === "completed" && !order.written_off && !order.account_id && Number(order.total) > 0;
  const valid = pending || Number.isSafeInteger(amountCents) && amountCents > 0 && amountCents <= receiptCents(order.total) && Boolean(reason.trim());
  if (!eligible && !pending) return null;
  async function send(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!valid || attempt.sending()) return;
    setError("");
    const body = attempt.body({ action: "prepare", orderId: order.id, amountCents, reason,
      expected: { totalCents: receiptCents(order.total), tipCents: receiptCents(order.tip ?? 0), serviceCents: receiptCents(order.service_fee ?? 0) } });
    try {
      const res = await fetch("/api/order-refunds", { method: "POST", headers: { "Content-Type": "application/json" }, body });
      const data = await res.json();
      if (!res.ok) {
        if (attempt.settles(res.status)) attempt.clear();
        setError(data.error ?? t("done.networkError")); return;
      }
      if (data.outcome !== "prepared") { setError(t("done.networkError")); return; }
      attempt.clear(); setAmount(""); setReason(""); setOpen(false);
      toast(t("returns.prepared"));
      // Preparation changes the retained balance; payout remains a separate confirmation.
      await onPrepared();
      await mutate(key => Array.isArray(key) && key[0] === "/api/order-refunds");
      router.refresh();
    } catch { setError(t("done.networkError")); }
    finally { attempt.ended(); }
  }
  return <>
    <button type="button" data-order-return className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => setOpen(true)}>
      {t(pending ? "returns.resume" : "returns.action")}
    </button>
    <Modal open={open} onClose={() => setOpen(false)} maxWidth={440} label={t("returns.action")}>
      <form onSubmit={send} data-return-form>
        <h3 className="tt-serif" style={{ marginTop: 0 }}>{t("returns.order", { code: orderCode(order.id) })}</h3>
        <p className="tt-muted">{t("returns.saleKept")}</p>
        <p>{t("returns.upTo", { amount: formatMoney((frozen?.expected.totalCents ?? receiptCents(order.total)) / 100, order.currency) })}</p>
        {attempt.unconfirmed() && <PendingAttempt message={t("returns.unconfirmed")} busy={attempt.sending()} onDiscard={() => { attempt.clear(); setError(""); }} />}
        <label className="tt-field">{t("returns.amount")}
          <input className="tt-input" style={{ width: "100%" }} inputMode="decimal" aria-label={t("returns.amount")}
            value={frozen ? (frozen.amountCents / 100).toFixed(2) : amount} disabled={pending} required
            onChange={event => setAmount(event.target.value)} />
        </label>
        <label className="tt-field">{t("returns.reason")}
          <input className="tt-input" style={{ width: "100%" }} aria-label={t("returns.reason")} maxLength={500}
            value={frozen?.reason ?? reason} disabled={pending} required onChange={event => setReason(event.target.value)} />
        </label>
        {error && <p role="alert" className="tt-field-error">{error}</p>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
          <button type="submit" className="tt-btn tt-btn-primary" disabled={!valid || attempt.sending()}>
            {t(attempt.sending() ? "common.saving" : pending ? "pending.sendAgain" : "returns.prepare")}
          </button>
          <button type="button" className="tt-btn tt-btn-ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</button>
        </div>
      </form>
    </Modal>
  </>;
}
