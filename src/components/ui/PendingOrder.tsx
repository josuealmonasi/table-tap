"use client";

import { formatMoney } from "@/lib/format";
import { lineUnitPrice, type OrderLineItem } from "@/lib/types";
import { useT } from "@/lib/i18n/context";
import PendingAttempt from "./PendingAttempt";

export interface PendingOrderDetails {
  items: OrderLineItem[];
  note?: string;
  customerName?: string;
  tableLabel?: string | null;
  tipPct?: number;
  tipAmount?: number;
  couponCode?: string;
}

interface PendingOrderProps {
  order: PendingOrderDetails;
  message: string;
  currency: string;
  busy: boolean;
  onSend: () => void;
  onDiscard?: () => void;
  children?: React.ReactNode;
}

/** Read from the saved request, so a retry never hides behind today's cart. */
export default function PendingOrder({ order, message, currency, busy, onSend, onDiscard, children }: PendingOrderProps) {
  const t = useT();
  return (
    <div className="tt-prodform tt-pending-order">
      <PendingAttempt message={message} busy={busy} onDiscard={onDiscard} />
      {order.tableLabel && <p>{t("menu.table", { label: order.tableLabel })}</p>}
      {order.customerName && <p>{order.customerName}</p>}
      <ol>
        {order.items.map((line, index) => (
          <li key={`${line.itemId}:${index}`}>
            <strong>{line.qty} × {line.name}</strong>
            <p>{formatMoney(line.qty * lineUnitPrice(line), currency)}</p>
            {Object.values(line.mods ?? {}).flat().length > 0 && <p>{Object.values(line.mods ?? {}).flat().join(", ")}</p>}
            {line.extras?.map(e => <p key={e.id}>+ {e.name}</p>)}
            {line.notes && <p>{line.notes}</p>}
            {line.components?.map(c => <div key={c.itemId}>
              <p>{c.qty} × {c.name}</p>
              {Object.values(c.mods ?? {}).flat().length > 0 && <p>{Object.values(c.mods ?? {}).flat().join(", ")}</p>}
              {c.extras?.map(e => <p key={e.id}>+ {e.name}</p>)}
            </div>)}
          </li>
        ))}
      </ol>
      {order.note && <p>{order.note}</p>}
      {order.couponCode && <p>{t("pending.coupon", { code: order.couponCode })}</p>}
      {Boolean(order.tipAmount || order.tipPct) && <p>{t("pending.tip", { amount: order.tipAmount !== undefined ? formatMoney(order.tipAmount, currency) : `${order.tipPct}%` })}</p>}
      {children}
      <button type="button" className="tt-btn tt-btn-primary" disabled={busy} onClick={onSend}>
        {t(busy ? "pending.sending" : "pending.sendAgain")}
      </button>
    </div>
  );
}
