"use client";

import { mutate } from "swr";
import ManualReturnAttribution from "./ManualReturnAttribution";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { RefundOperation } from "@/lib/refunds/operations";

interface Props { refunds: RefundOperation[] }

export default function OrderRefunds({ refunds }: Props) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const [drawers, setDrawers] = useState<Record<string, "original" | "me">>({});
  const [busy, setBusy] = useState<string | null>(null);
  if (!refunds.length) return null;

  async function finish(row: RefundOperation): Promise<void> {
    const drawer = drawers[row.id] ?? (row.original_collector ? "original" : "me");
    if (row.source !== "stripe" && !await confirm({
      title: t("returns.confirm"),
      message: t("returns.drawer", { amount: formatMoney(Number(row.amount), row.currency), collector: drawer === "me" ? t("returns.myDrawer") : row.original_collector ?? "—" }),
      confirmLabel: t("returns.returned"),
    })) return;
    setBusy(row.id);
    try {
      const res = await fetch("/api/order-refunds", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, confirmReturned: true, drawer }),
      });
      const data = await res.json();
      toast(!res.ok ? data.error : t(data.completed ? "returns.done" : "returns.pending"), !res.ok ? "error" : undefined);
      await mutate(key => Array.isArray(key) && key[0] === "/api/order-refunds");
      router.refresh();
    } catch { toast(t("done.networkError"), "error"); }
    finally { setBusy(null); }
  }

  return <section className="tt-section">
    <h3 className="tt-serif">{t("returns.title")}</h3>
    <p className="tt-muted">{t("returns.intro")}</p>
    {refunds.map(row => <div key={row.id} className="tt-bill-row tt-bill-approval">
      <div className="tt-bill-main">
        <strong>{formatMoney(row.outstanding_cents === undefined ? Number(row.amount) : row.outstanding_cents / 100, row.currency)}</strong>
        {row.outstanding_cents !== undefined && row.outstanding_cents < Math.round(Number(row.amount) * 100)
          && <span className="tt-muted tt-bill-sub">{t("returns.alreadyReturned", { amount: formatMoney(Number(row.amount) - row.outstanding_cents / 100, row.currency) })}</span>}
        <span className="tt-muted tt-bill-sub">{t(`returns.${row.source}`)} · {t(`returns.${row.status}`)}</span>
      </div>
      <div className="tt-bill-actions-row" style={{ flexWrap: "wrap" }}>
        {row.source !== "stripe" && row.source !== "review" && <label className="tt-field" style={{ width: "100%" }}>
          {t("returns.payoutDrawer")}
          <select className="tt-input" style={{ width: "100%" }} value={drawers[row.id] ?? (row.original_collector ? "original" : "me")}
            onChange={e => setDrawers(s => ({ ...s, [row.id]: e.target.value as "original" | "me" }))}>
            {row.original_collector && <option value="original">{row.original_collector}</option>}
            <option value="me">{t("returns.myDrawer")}</option>
          </select>
        </label>}
        {row.source === "review"
          ? <span className="tt-muted tt-bill-sub">{t("returns.reviewHelp")}</span>
          : <button className="tt-btn tt-btn-primary tt-btn-sm" disabled={busy === row.id}
            onClick={() => void finish(row)}>{t(row.source === "stripe" ? "returns.check" : "returns.returned")}</button>}
        {row.source === "stripe" && <ManualReturnAttribution operationId={row.id} onRecorded={() => router.refresh()} />}
      </div>
    </div>)}
  </section>;
}
