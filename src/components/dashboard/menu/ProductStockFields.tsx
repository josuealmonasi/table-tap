"use client";

import { formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n/context";

interface ProductStockFieldsProps {
  discountPct: string;
  onDiscountPct: (value: string) => void;
  /** The clamped percentage, and the prices it produces. */
  pct: number;
  basePrice: number;
  salePrice: number;
  stock: string;
  onStock: (value: string) => void;
  /** Whether the plan includes counting stock. */
  inventoryAllowed: boolean;
  currency: string;
}

/** What the dish costs a diner after its discount, and how many are left. */
export default function ProductStockFields(p: ProductStockFieldsProps) {
  const t = useT();
  return (
    <>
      <div className="tt-prodform-row">
        <input
          className="tt-input"
          style={{ width: 110 }}
          type="number"
          step="1"
          min="0"
          max="99"
          placeholder={t("menu.discountPlaceholder")}
          value={p.discountPct}
          onChange={e => p.onDiscountPct(e.target.value)}
        />
        <span className="tt-muted" style={{ fontSize: 13 }}>
          {p.pct > 0 ? (
            <>
              <s>{formatMoney(p.basePrice, p.currency)}</s>{" "}
              <strong className="tt-accent">
                {formatMoney(p.salePrice, p.currency)}
              </strong>{" "}
              {t("menu.discountShownToCustomers")}
            </>
          ) : (
            t("menu.discountHint")
          )}
        </span>
      </div>

      <div className="tt-prodform-row">
        <input
          className="tt-input"
          style={{ width: 110 }}
          type="number"
          step="1"
          min="0"
          inputMode="numeric"
          aria-label={t("menu.stock")}
          placeholder={t("menu.stockPlaceholder")}
          disabled={!p.inventoryAllowed}
          value={p.inventoryAllowed ? p.stock : ""}
          onChange={e => {
            // Zero is valid to hold — it is what selling out leaves behind,
            // and the form opens on it — so the refusal lives here rather than
            // in `min`. As min="1" the field made a sold-out dish's whole form
            // invalid, and its name could not be corrected until it was
            // restocked. Only a zero somebody types is refused.
            const next = e.target.value;
            if (next !== "" && Number(next) === 0) return;
            p.onStock(next);
          }}
        />
        <span className="tt-muted" style={{ fontSize: 13 }}>
          {p.inventoryAllowed ? t("menu.stockHint") : t("menu.stockLocked")}
        </span>
      </div>
    </>
  );
}
