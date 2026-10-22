"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/format";
import { percent } from "@/lib/costs/display";
import type { FeeRate } from "@/lib/costs/fees";
import { useCostsSend } from "@/hooks/useCostsSend";

interface FeeCardProps {
  fees: FeeRate;
  terminalFeePct: number;
  currency: string;
  unverifiedFees: number;
}

/**
 * The fee every margin assumes, and where it comes from: the last 30 days'
 * mix of cash, cards through TableTap and the restaurant's own terminal. The
 * terminal's rate is the one figure only the owner knows, so it is asked here.
 */
export default function FeeCard({ fees, terminalFeePct, currency, unverifiedFees }: FeeCardProps) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const send = useCostsSend();
  const [pct, setPct] = useState(String(terminalFeePct));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const money = (n: number) => formatMoney(n, currency);
  const changed = pct.trim() !== String(terminalFeePct);

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const failed = await send("/api/costs/settings", "PATCH", { terminalFeePct: pct });
    setBusy(false);
    if (failed) return setError(failed);
    toast(t("costs.feeSaved"));
    router.refresh();
  }

  return (
    <section className="tt-section tt-costs-fee">
      <h2 className="tt-costs-heading">{t("costs.feeTitle", { pct: percent(fees.rate) })}</h2>
      <p className="tt-muted">
        {fees.takings > 0
          ? t("costs.feeMix", { cash: money(fees.cash), online: money(fees.online), terminal: money(fees.terminal) })
          : t("costs.feeNoSales")}
      </p>
      <p className="tt-muted">{t("costs.feeStripe")}</p>
      {unverifiedFees > 0 && <p className="tt-muted">{t("costs.feeUnverified", { count: unverifiedFees })}</p>}
      <form className="tt-costs-fee-form" onSubmit={e => void save(e)}>
        <label className="tt-field">
          <span className="tt-mod-label">{t("costs.feeTerminal")}</span>
          <input className="tt-input" inputMode="decimal" value={pct} onChange={e => setPct(e.target.value)} />
        </label>
        <button type="submit" className="tt-btn tt-btn-primary tt-btn-sm" disabled={busy || !changed}>
          {busy ? t("common.saving") : t("common.save")}
        </button>
      </form>
      {error && <p className="tt-field-error" role="alert">{error}</p>}
    </section>
  );
}
