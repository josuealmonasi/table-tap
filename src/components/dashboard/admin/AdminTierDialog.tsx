"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { planLabel } from "@/lib/plan";

export type TierBillingChoice = "next_bill" | "payment_link" | "free";

export interface TierAssignment {
  billing: TierBillingChoice;
  /** yyyy-mm-dd, only with a payment link. */
  payBy?: string;
}

interface AdminTierDialogProps {
  name: string;
  plan: string;
  /** Pays through a live Stripe subscription: the new price starts with its next bill. */
  billedByStripe: boolean;
  busy: boolean;
  onClose: () => void;
  onAssign: (choice: TierAssignment) => void;
}

/** Today plus `days`, as the yyyy-mm-dd a date input reads. */
function dayFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * How a tier the admin assigns gets paid. A restaurant paying through Stripe
 * has one answer, its next bill; one that is not chooses between a payment
 * link with a date to pay by, and free. Carta costs nothing, so it is free.
 */
export default function AdminTierDialog({ name, plan, billedByStripe, busy, onClose, onAssign }: AdminTierDialogProps) {
  const t = useT();
  const free = plan === "carta";
  const [billing, setBilling] = useState<TierBillingChoice>(free ? "free" : billedByStripe ? "next_bill" : "payment_link");
  const [payBy, setPayBy] = useState(dayFromNow(7));
  const label = planLabel(plan);

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    // End of that day in Mexico City, so "pay by the 24th" includes the 24th.
    onAssign(billing === "payment_link" ? { billing, payBy: `${payBy}T23:59:00-06:00` } : { billing });
  }

  return (
    <Modal open onClose={onClose} maxWidth={460} title={t("admin.planConfirmTitle", { name, plan: label })}>
      <form className="tt-prodform" onSubmit={submit}>
        {billedByStripe && !free ? (
          <p className="tt-muted" style={{ margin: 0, fontSize: 13 }}>{t("admin.tierNextBillMsg", { plan: label })}</p>
        ) : free ? (
          <p className="tt-muted" style={{ margin: 0, fontSize: 13 }}>{t("admin.planConfirmMsg", { plan: label })}</p>
        ) : (
          <>
            <label className="tt-field">
              <span className="tt-mod-label">{t("admin.tierBilling")}</span>
              <select className="tt-input" value={billing} onChange={e => setBilling(e.target.value as TierBillingChoice)}>
                <option value="payment_link">{t("admin.tierPaymentLink")}</option>
                <option value="free">{t("admin.tierFree")}</option>
              </select>
            </label>
            {billing === "payment_link" ? (
              <>
                <label className="tt-field">
                  <span className="tt-mod-label">{t("admin.tierPayBy")}</span>
                  <input className="tt-input" type="date" required value={payBy}
                    min={dayFromNow(1)} max={dayFromNow(59)} onChange={e => setPayBy(e.target.value)} />
                </label>
                <p className="tt-muted" style={{ margin: 0, fontSize: 13 }}>{t("admin.tierPaymentLinkMsg", { plan: label })}</p>
              </>
            ) : (
              <p className="tt-muted" style={{ margin: 0, fontSize: 13 }}>{t("admin.planConfirmMsg", { plan: label })}</p>
            )}
          </>
        )}
        <div className="tt-prodform-actions">
          <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="tt-btn tt-btn-primary tt-btn-sm" disabled={busy || (billing === "payment_link" && !payBy)}>
            {busy ? t("common.saving") : t("admin.tierAssign")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
