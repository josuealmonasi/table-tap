"use client";

import { useState, type FormEvent } from "react";
import { mutate } from "swr";
import { useRetryIntent } from "@/hooks/useRetryIntent";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

interface Props { operationId: string; onRecorded: () => void }

/** This assigns a refund already made in Stripe; it never sends another one. */
export default function ManualReturnAttribution({ operationId, onRecorded }: Props) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const attempt = useRetryIntent();
  const [refundId, setRefundId] = useState("");
  const frozen = attempt.frozen<{ refundId: string }>();
  async function record(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (attempt.sending() || !await confirm({ title: t("returns.manualTitle"), message: t("returns.manualConfirm"),
      confirmLabel: t("returns.manualSave") })) return;
    try {
      const response = await fetch("/api/order-refunds", { method: "POST", headers: { "Content-Type": "application/json" },
        body: attempt.body({ action: "attribute", id: operationId, refundId }) });
      const data = await response.json();
      if (!response.ok) {
        if (attempt.settles(response.status)) attempt.clear();
        toast(data.error ?? t("done.networkError"), "error"); return;
      }
      attempt.clear(); setRefundId(""); onRecorded();
      await mutate(key => Array.isArray(key) && key[0] === "/api/order-refunds");
      toast(t(data.completed ? "returns.done" : "returns.manualRecorded"));
    } catch { toast(t("done.networkError"), "error"); }
    finally { attempt.ended(); }
  }
  return <details style={{ width: "100%", marginTop: 8 }}>
    <summary>{t("returns.manualTitle")}</summary>
    <form onSubmit={record}>
      <p className="tt-muted">{t("returns.manualHelp")}</p>
      <label className="tt-field">{t("returns.manualId")}
        <input className="tt-input" style={{ width: "100%" }} aria-label={t("returns.manualId")} maxLength={100}
          value={frozen?.refundId ?? refundId} disabled={attempt.pending()} onChange={event => setRefundId(event.target.value)} required />
      </label>
      <button type="submit" className="tt-btn tt-btn-ghost tt-btn-sm" disabled={attempt.sending() || !/^re_[a-zA-Z0-9]+$/.test(frozen?.refundId ?? refundId)}>
        {t(attempt.sending() ? "common.saving" : "returns.manualSave")}
      </button>
    </form>
  </details>;
}
