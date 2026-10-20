"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";
import { useCostsSend } from "@/hooks/useCostsSend";
import type { UnverifiedDeposit } from "@/lib/terminal-report";

interface Props { deposit: UnverifiedDeposit }
export default function VerifyDeposit({ deposit }: Props) {
  const t = useT();
  const router = useRouter();
  const send = useCostsSend();
  const [currency, setCurrency] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function verify(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const failed = await send("/api/terminal/deposits/verify", "POST", { id: deposit.id, currency, reason, confirmed });
      setError(failed);
      if (!failed) router.refresh();
    } finally { setBusy(false); }
  }
  return <form className="tt-section" onSubmit={verify}>
    <h3>{t("terminal.unverifiedTitle")}</h3><p>{t("terminal.unverifiedHint")}</p>
    <p>{deposit.sales_day} · {t("terminal.unverifiedAmounts", { expected: Number(deposit.expected).toFixed(2), received: Number(deposit.received).toFixed(2) })}</p>
    <label className="tt-field"><span>{t("recovery.currency")}</span>
      <select className="tt-input" value={currency} onChange={e => setCurrency(e.target.value)} required>
        <option value="">{t("terminal.chooseCurrency")}</option><option value="MXN">MXN</option><option value="USD">USD</option>
      </select>
    </label>
    <label className="tt-field"><span>{t("recovery.reason")}</span><input className="tt-input" value={reason} onChange={e => setReason(e.target.value)} maxLength={500} /></label>
    <label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> {t("terminal.verifyConfirm")}</label>
    {error && <p role="alert">{error}</p>}
    <button className="tt-btn tt-btn-primary" disabled={busy || !confirmed || !currency || reason.trim().length < 8}>{t("common.save")}</button>
  </form>;
}
