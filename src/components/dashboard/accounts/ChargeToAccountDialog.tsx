"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/format";
import AccountPicker from "./AccountPicker";
import type { AccountListItem } from "@/hooks/useOpenAccounts";

interface ChargeToAccountDialogProps {
  open: boolean;
  onClose: () => void;
  /** The bill's orders still owed, and their total as the waiter sees it. */
  orderIds: string[];
  amount: number;
  currency: string;
  label: string;
  onCharged: () => void;
}

/**
 * "Ponlo en mi cuenta": a bill goes onto a customer's account. Two steps —
 * whose account, then yes — because the second press is the approval the log
 * records, with this person's name and this amount on it.
 */
export default function ChargeToAccountDialog({
  open, onClose, orderIds, amount, currency, label, onCharged,
}: ChargeToAccountDialogProps) {
  const t = useT();
  const toast = useToast();
  const [picked, setPicked] = useState<AccountListItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close(): void {
    setPicked(null);
    setError(null);
    onClose();
  }

  async function charge(): Promise<void> {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts/charge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: picked.id, orderIds, expected: amount }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? t("apiErr.generic"));
        return;
      }
      toast(t("accounts.charged", { name: picked.name, amount: formatMoney(amount, currency) }));
      onCharged();
      close();
    } catch {
      setError(t("done.networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} maxWidth={460} title={t("accounts.chargeTitle", { label })}>
      {picked ? (
        <div className="tt-account-confirm">
          <p>
            {t("accounts.chargeConfirm", { amount: formatMoney(amount, currency), name: picked.name })}
          </p>
          {error && <p className="tt-field-error" role="alert">{error}</p>}
          <div className="tt-prodform-actions">
            <button type="button" className="tt-btn tt-btn-primary" disabled={busy} onClick={() => void charge()}>
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
  );
}
