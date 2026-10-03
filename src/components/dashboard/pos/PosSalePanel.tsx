"use client";

import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import CartLineRow from "@/components/customer/CartLineRow";
import type { CartItem } from "@/hooks/useCart";
import type { MenuItem } from "@/lib/types";
import type { AccountListItem } from "@/hooks/useOpenAccounts";
import PosAccountCharge from "./PosAccountCharge";

interface PosSalePanelProps {
  lines: CartItem[];
  items: MenuItem[];
  currency: string;
  total: number;
  /** What an account is charged: the sale without a tip, which waits for the day it is paid. */
  accountAmount: number;
  /** Nothing can be charged: a sale in flight, no menu serving, or an empty sale. */
  locked: boolean;
  canChargeAccount: boolean;
  onChangeQty: (cartId: number, qty: number) => void;
  onEdit: (line: CartItem) => void;
  onCharge: (method: "cash" | "card") => void;
  onChargeAccount: (account: AccountListItem) => Promise<void>;
}

/** The sale itself: its lines, its total, and the ways to take the money. */
export default function PosSalePanel({
  lines,
  items,
  currency,
  total,
  accountAmount,
  locked,
  canChargeAccount,
  onChangeQty,
  onEdit,
  onCharge,
  onChargeAccount,
}: PosSalePanelProps) {
  const t = useT();
  return (
    <aside className="tt-pos-cart">
      <h3 className="tt-serif" style={{ marginTop: 0 }}>
        {t("pos.sale")}
      </h3>

      {lines.length === 0 ? (
        <p className="tt-muted">{t("pos.empty")}</p>
      ) : (
        <div className="tt-pos-lines">
          {lines.map(line => (
            <CartLineRow
              key={line.cartId}
              item={line}
              currency={currency}
              imageUrl={items.find(i => i.id === line.itemId)?.image_url ?? null}
              onRemove={cartId => onChangeQty(cartId, 0)}
              onChangeQty={onChangeQty}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}

      <div className="tt-pos-total">
        <span>{t("pos.total")}</span>
        <strong>{formatMoney(total, currency)}</strong>
      </div>

      <div className="tt-pos-charge">
        <button
          type="button"
          className="tt-btn tt-btn-primary"
          disabled={locked}
          onClick={() => onCharge("cash")}
        >
          {t("pos.chargeCash")}
        </button>
        <button
          type="button"
          className="tt-btn tt-btn-primary"
          disabled={locked}
          onClick={() => onCharge("card")}
        >
          {t("pos.chargeCard")}
        </button>
        {canChargeAccount && (
          <PosAccountCharge
            amount={accountAmount}
            currency={currency}
            disabled={locked}
            onCharge={onChargeAccount}
          />
        )}
      </div>
    </aside>
  );
}
