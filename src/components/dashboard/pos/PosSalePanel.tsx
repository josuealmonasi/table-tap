"use client";

import PendingOrder from "@/components/ui/PendingOrder";
import type { PendingAccountSale } from "@/hooks/usePosCharge";
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
  accountRetry?: PendingAccountSale | null;
  onRetryAccount?: () => void;
  onChangeQty: (cartId: number, qty: number) => void;
  onEdit: (line: CartItem) => void;
  onCharge: (method: "cash" | "card") => void;
  onChargeAccount: (account: AccountListItem) => Promise<void>;
  /** Rings the sale before this one again; absent when there is none to ring. */
  onRepeat?: () => void;
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
  accountRetry,
  onRetryAccount,
  onChangeQty,
  onEdit,
  onCharge,
  onChargeAccount,
  onRepeat,
}: PosSalePanelProps) {
  const t = useT();
  if (accountRetry) return (
    <aside className="tt-pos-cart">
      <PendingOrder currency={accountRetry.currency} order={accountRetry} message={t("pending.account", { name: accountRetry.name, amount: formatMoney(accountRetry.amount, accountRetry.currency) })}
        busy={locked} onSend={() => onRetryAccount?.()} />
    </aside>
  );
  return (
    <aside className="tt-pos-cart">
      <h3 className="tt-serif" style={{ marginTop: 0 }}>
        {t("pos.sale")}
      </h3>

      {lines.length === 0 ? (
        <>
          <p className="tt-muted">{t("pos.empty")}</p>
          {onRepeat && (
            <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={onRepeat}>
              {t("pos.repeatLast")}
            </button>
          )}
        </>
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
