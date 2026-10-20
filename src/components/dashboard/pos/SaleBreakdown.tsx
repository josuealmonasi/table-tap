"use client";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import type { OrderLineItem } from "@/lib/types";
import type { OfflineCharge } from "@/lib/offline-sale";

interface Props { items: OrderLineItem[]; charge: Omit<OfflineCharge, "at">; currency: string }
export default function SaleBreakdown({ items, charge, currency }: Props) {
  const t = useT();
  const money = (n: number) => formatMoney(n, currency);
  return <>
    <ul>{items.map((l, i) => <li key={`${l.itemId}-${i}`}>
      {l.qty} × {l.name} · {money(l.price)}
      {Number(l.discountPct) > 0 && ` · ${t("recovery.lineDiscount", { pct: l.discountPct! })}`}
      {Object.entries(l.mods ?? {}).map(([key, value]) => <div key={key}>{key}: {Array.isArray(value) ? value.join(", ") : value}</div>)}
      {l.extras?.map((extra, index) => <div key={`${extra.id}-${index}`}>+ {extra.name} · {money(extra.price)}</div>)}
      {l.components?.map((part, index) => <div key={`${part.itemId}-${index}`}>{part.qty} × {part.name}</div>)}
    </li>)}</ul>
    <dl>{(["subtotal", "discount", "serviceFee", "tip", "total"] as const).map(key => <div key={key}>
      <dt>{t(`recovery.breakdown.${key}`)}</dt><dd>{money(charge[key])}</dd>
    </div>)}</dl>
  </>;
}
