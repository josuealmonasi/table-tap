"use client";

import { usePaymentCheck } from "@/hooks/usePaymentCheck";

import { useRef, useState, type JSX } from "react";
import { badgesChanged } from "@/hooks/useBadges";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import type { StaffSlotSplit } from "@/lib/split-slots-staff";
import { owedCents } from "@/lib/write-off-cents";
import { unpaidOrders } from "@/lib/table-bill";
import type { Order } from "@/lib/types";
import type { WriteOffReason } from "@/lib/write-off";
import WriteOffDialog from "./WriteOffDialog";

interface Props {
  split: StaffSlotSplit;
  orders: Order[];
  canApprove: boolean;
  onClose: () => void;
  onApplied: () => void;
  onRefresh?: () => void | Promise<void>;
}

/** The chosen division ends together; a later round is a separate loss. */
export default function SplitWriteOffDialog({ split, orders, canApprove, onClose, onApplied, onRefresh = onApplied }: Props): JSX.Element {
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paymentCheck = usePaymentCheck(onRefresh, split.id);
  const sending = useRef(false);
  // Frozen slots round the pooled bill; write-off rounds each order before its coverage.
  const dividedOrders = unpaidOrders(orders).filter(o => split.orderIds.includes(o.id));
  const expectedCents = owedCents(dividedOrders, new Map(dividedOrders.map(o => [o.id, Number(o.collected ?? 0)])));

  async function submit(reason: WriteOffReason, note: string): Promise<void> {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError(null);
    try {
      const res = await fetch("/api/bill/write-off", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: split.orderIds, expectedCents, reason, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { paymentCheck.capture(data, { kind: "orders", orderIds: split.orderIds }); setError(data.error ?? t("apiErr.generic")); return; }
      badgesChanged();
      toast(t(data.pending ? "writeOff.sent" : "writeOff.done"));
      onApplied(); onClose();
    } catch { setError(t("done.networkError")); }
    finally { sending.current = false; setBusy(false); }
  }

  return <WriteOffDialog open onClose={onClose} amount={expectedCents / 100} divided
    currency={split.currency ?? "MXN"} canApprove={canApprove} busy={busy} error={error} paymentCheck={paymentCheck.action} onSubmit={submit} />;
}
