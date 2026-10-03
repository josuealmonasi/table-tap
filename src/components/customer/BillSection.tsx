"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { PAID_LINES_SHOWN, type BillSide } from "@/lib/table-bill";
import { itemSalePrice } from "@/lib/pricing";
import DishImage from "./DishImage";

/** One dish on the bill, laid out like a cart line but not editable. */
function BillLine({
  name,
  emoji,
  imageUrl,
  qty,
  price,
  discountPct,
  extras,
  currency,
}: {
  name: string;
  emoji: string;
  imageUrl: string | null;
  qty: number;
  price: number;
  /** What came off this dish when it was ordered; the total already has it. */
  discountPct?: number;
  extras?: { name: string; price: number }[];
  currency: string;
}) {
  // What this line actually contributed to the bill: the sale price the dish
  // was ordered at, plus its extras. Showing the list price here made the
  // lines add up to more than the total a diner was being asked to pay —
  // 13.50 of dishes under a total of 11.70 — which is the sort of arithmetic
  // that gets a bill queried in front of everyone.
  const extrasEach = (extras ?? []).reduce((sum, e) => sum + e.price, 0);
  const charged = (itemSalePrice(price, discountPct) + extrasEach) * qty;
  const listed = (price + extrasEach) * qty;
  return (
    <div className="tt-card" style={{ padding: 14 }}>
      <div className="tt-line">
        <div className="tt-line-thumb">
          <DishImage url={imageUrl} emoji={emoji} name={name} />
        </div>
        <div className="tt-line-body">
          <strong>
            {qty}× {name}
          </strong>
        </div>
        <div className="tt-line-actions">
          {charged < listed && (
            <span className="tt-was" style={{ fontSize: 13 }}>
              {formatMoney(listed, currency)}
            </span>
          )}
          <strong className="tt-accent">{formatMoney(charged, currency)}</strong>
        </div>
      </div>
    </div>
  );
}

export default function BillSection({
  heading,
  side,
  currency,
  photoOf,
  settled = false,
  collapsible = false,
}: {
  heading: string;
  side: BillSide;
  currency: string;
  photoOf: (itemId: string) => string | null;
  /** Already paid: shown dimmed and counted in no total. */
  settled?: boolean;
  /** Summarised when there are many rows, so the total is not pushed off screen. */
  collapsible?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (side.orders.length === 0) return null;
  const foldable = collapsible && side.items.length > PAID_LINES_SHOWN;
  const shown = foldable && !open ? side.items.slice(0, PAID_LINES_SHOWN) : side.items;
  return (
    <div className={settled ? "tt-bill-settled" : undefined}>
      <div className="tt-mod-label" style={{ marginTop: 4 }}>
        {heading}
        {settled && <span className="tt-badge tt-badge-green">{"\u2713"}</span>}
        {foldable && (
          <button
            type="button"
            className="tt-linkbtn"
            aria-expanded={open}
            onClick={() => setOpen(v => !v)}
          >
            {t(open ? "bill.hideLines" : "bill.showLines", { n: side.items.length })}
          </button>
        )}
      </div>
      {shown.map((item, i) => (
        <BillLine
          key={i}
          name={item.name}
          emoji={item.emoji}
          imageUrl={photoOf(item.itemId)}
          qty={item.qty}
          price={item.price}
          discountPct={item.discountPct}
          extras={item.extras}
          currency={currency}
        />
      ))}
    </div>
  );
}
