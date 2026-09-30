"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/format";
import TipPicker from "@/components/customer/TipPicker";

interface SettleAccountDialogProps {
  open: boolean;
  onClose: () => void;
  accountId: string;
  name: string;
  /** The balance on screen: what the customer is paying. */
  owed: number;
  currency: string;
  onSettled: () => void;
}

/**
 * The customer pays their account at the till, all of it. The tip chips are
 * the ones the diner's own cart shows, so the customer decides the same way
 * whether they pay here or on their phone; then cash or the terminal.
 */
export default function SettleAccountDialog({
  open, onClose, accountId, name, owed, currency, onSettled,
}: SettleAccountDialogProps) {
  const t = useT();
  const toast = useToast();
  const [tipPct, setTipPct] = useState(0);
  const [tipCustom, setTipCustom] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One reference per attempt: a second tap is the same payment, not another.
  const ref = useMemo(() => (open ? crypto.randomUUID() : ""), [open]);

  const tip = tipCustom ?? Math.round(owed * tipPct) / 100;
  const safeTip = Math.min(Math.max(0, tip), owed);
  const money = (n: number) => formatMoney(n, currency);

  async function collect(method: "cash" | "card"): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, expected: owed, tip: safeTip, method, ref }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? t("apiErr.generic"));
        return;
      }
      toast(t("accounts.settled", { name, amount: money(owed + safeTip) }));
      onSettled();
      onClose();
    } catch {
      setError(t("done.networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth={460} title={t("accounts.settleTitle", { name })}>
      <p className="tt-account-settle-owed">{t("accounts.settleOwed", { amount: money(owed) })}</p>
      <div className="tt-pos-tip">
        <TipPicker
          currency={currency}
          tipPct={tipCustom !== null ? 0 : tipPct}
          tipCustom={tipCustom}
          maxTip={owed}
          onPresetTip={pct => {
            setTipCustom(null);
            setTipPct(pct);
          }}
          onCustomTip={amount => {
            setTipCustom(amount);
            if (amount !== null) setTipPct(0);
          }}
        />
      </div>
      <p className="tt-account-settle-total">{t("accounts.settleTotal", { amount: money(owed + safeTip) })}</p>
      {error && <p className="tt-field-error" role="alert">{error}</p>}
      <div className="tt-bill-actions">
        <button type="button" className="tt-btn tt-btn-primary tt-btn-lg" style={{ width: "100%" }} disabled={busy} onClick={() => void collect("cash")}>
          {t("settle.cash")}
        </button>
        <button type="button" className="tt-btn tt-btn-ghost tt-btn-lg" style={{ width: "100%", marginTop: 8 }} disabled={busy} onClick={() => void collect("card")}>
          {t("settle.card")}
        </button>
      </div>
    </Modal>
  );
}
