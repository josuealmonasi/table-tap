"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import AccountPicker from "@/components/dashboard/accounts/AccountPicker";
import type { AccountListItem } from "@/hooks/useOpenAccounts";

interface PosAccountChargeProps {
  /** The sale without a tip: on an account the tip is left when it is paid. */
  amount: number;
  currency: string;
  disabled: boolean;
  onCharge: (account: AccountListItem) => Promise<void>;
}

/**
 * "Ponlo en mi cuenta" at the till: the sale goes out now and the customer's
 * account owes it. Whose account, then yes — the cashier's second press is
 * the approval the log records.
 */
export default function PosAccountCharge({ amount, currency, disabled, onCharge }: PosAccountChargeProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<AccountListItem | null>(null);
  const [busy, setBusy] = useState(false);

  function close(): void {
    setOpen(false);
    setPicked(null);
  }

  return (
    <>
      <button type="button" className="tt-btn tt-btn-ghost" disabled={disabled} onClick={() => setOpen(true)}>
        {t("pos.chargeAccount")}
      </button>
      <Modal open={open} onClose={close} maxWidth={460} title={t("pos.chargeAccountTitle", { amount: formatMoney(amount, currency) })}>
        {picked ? (
          <div className="tt-account-confirm">
            <p>{t("accounts.chargeConfirm", { amount: formatMoney(amount, currency), name: picked.name })}</p>
            <div className="tt-prodform-actions">
              <button
                type="button"
                className="tt-btn tt-btn-primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await onCharge(picked);
                  setBusy(false);
                  close();
                }}
              >
                {busy ? t("common.saving") : t("accounts.chargeAction")}
              </button>
              <button type="button" className="tt-btn tt-btn-ghost" disabled={busy} onClick={() => setPicked(null)}>
                {t("accounts.otherAccount")}
              </button>
            </div>
          </div>
        ) : (
          <AccountPicker active={open} amount={amount} currency={currency} onPick={setPicked} />
        )}
      </Modal>
    </>
  );
}
