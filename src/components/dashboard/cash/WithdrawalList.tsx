"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { CashMovement } from "@/lib/cash-drawer";
import { SEP } from "@/lib/separator";

interface WithdrawalListProps {
  /** The open shift's withdrawals, oldest first. */
  withdrawals: CashMovement[];
  /** A time of day, in the restaurant's zone. */
  time: (iso: string) => string;
}

type Action = "remove" | "approve" | "reject";

/**
 * The open shift's withdrawals, as a manager sees them: who took how much,
 * when and why. A cashier's withdrawal waits here for the manager to approve
 * it (then it comes out of expected cash) or reject it (it stays on record and
 * never counts). One written by mistake can be removed, unless it pays out a
 * resolved held receipt.
 */
export default function WithdrawalList({ withdrawals, time }: WithdrawalListProps) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);

  async function act(w: CashMovement, action: Action): Promise<void> {
    const amount = formatMoney(w.amount, w.currency);
    const words = {
      remove: { title: t("corte.removeWithdrawalTitle", { amount }), message: t("corte.removeWithdrawalMsg"), label: t("corte.removeWithdrawal"), done: t("corte.withdrawalRemoved") },
      approve: { title: t("corte.approveWithdrawalTitle", { amount }), message: t("corte.approveWithdrawalMsg", { who: w.actor_email }), label: t("corte.approveWithdrawal"), done: t("corte.withdrawalApproved") },
      reject: { title: t("corte.rejectWithdrawalTitle", { amount }), message: t("corte.rejectWithdrawalMsg", { who: w.actor_email }), label: t("corte.rejectWithdrawal"), done: t("corte.withdrawalRejected") },
    }[action];
    if (!(await confirm({ title: words.title, message: words.message, confirmLabel: words.label }))) return;
    setBusy(w.id);
    setFailure(null);
    try {
      const res = await fetch("/api/cash-drawer", {
        method: action === "remove" ? "DELETE" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "remove" ? { id: w.id } : { id: w.id, decision: action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = data.error ?? t("done.networkError");
        setFailure({ id: w.id, message });
        toast(message, "error");
      } else {
        toast(words.done);
        router.refresh();
      }
    } catch {
      setFailure({ id: w.id, message: t("done.networkError") });
      toast(t("done.networkError"), "error");
    } finally {
      setBusy(null);
    }
  }

  if (withdrawals.length === 0) return null;
  return (
    <ul className="tt-cashbox-list">
      {withdrawals.map(w => (
        <li key={w.id} className="tt-cashbox-item">
          <span className="tt-cashbox-what">
            <strong>{formatMoney(w.amount, w.currency)}</strong>
            <span className="tt-muted">
              {time(w.created_at)} · {w.actor_email}
              {w.note ? `${SEP}${w.note}` : ""}
            </span>
            {w.status === "pending" && <span className="tt-muted tt-costs-hint">{t("corte.withdrawalPending")}</span>}
            {w.status === "rejected" && <span className="tt-muted tt-costs-hint">{t("corte.withdrawalRejectedBy", { who: w.reviewed_by ?? "—" })}</span>}
            {failure?.id === w.id && <span role="alert">{failure.message}</span>}
          </span>
          {w.status === "pending" ? (
            <span className="tt-cashbox-actions">
              <button className="tt-btn tt-btn-ghost tt-btn-sm" disabled={busy === w.id} onClick={() => void act(w, "approve")}>
                {t("corte.approveWithdrawal")}
              </button>
              <button className="tt-btn tt-btn-ghost tt-btn-sm" disabled={busy === w.id} onClick={() => void act(w, "reject")}>
                {t("corte.rejectWithdrawal")}
              </button>
            </span>
          ) : w.status === "rejected" ? null : w.linked ? (
            // The server never removes a withdrawal that pays out a resolved
            // held receipt; say why instead of offering it.
            <span className="tt-muted tt-costs-hint">{t("corte.withdrawalLinked")}</span>
          ) : (
            <button className="tt-btn tt-btn-ghost tt-btn-sm" disabled={busy === w.id} onClick={() => void act(w, "remove")}>
              {t("corte.removeWithdrawal")}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
