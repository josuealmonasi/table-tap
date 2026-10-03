"use client";

import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/format";
import CartLineRow from "@/components/customer/CartLineRow";
import QrScanner from "@/components/dashboard/QrScanner";
import { tableFromScan } from "@/lib/scan-target";
import type { CartItem } from "@/hooks/useCart";
import type { MenuItem } from "@/lib/types";

interface PadOrderPanelProps {
  restaurantId: string;
  currency: string;
  tables: { id: string; label: string }[];
  tableId: string;
  onTable: (id: string) => void;
  lines: CartItem[];
  items: MenuItem[];
  note: string;
  onNote: (note: string) => void;
  total: number;
  /** The order is in flight or its confirmation is up. */
  sending: boolean;
  busy: boolean;
  closedNow: boolean;
  onChangeQty: (cartId: number, qty: number) => void;
  onEdit: (line: CartItem) => void;
  onSend: () => void;
}

/** The round being written down: which table, the dishes, a note, and send. */
export default function PadOrderPanel(p: PadOrderPanelProps) {
  const t = useT();
  const toast = useToast();
  return (
    <aside className="tt-pos-cart">
      <h3 className="tt-serif" style={{ marginTop: 0 }}>
        {t("waiter.order")}
      </h3>

      {/* Which table, before anything else. It is the one thing that makes
          this order findable afterwards — on the board, on the bill, and in
          the history search. */}
      <label className="tt-field">
        <span className="tt-mod-label">{t("waiter.table")}</span>
        <div className="tt-waiter-table">
          <select
            className="tt-input"
            value={p.tableId}
            onChange={e => p.onTable(e.target.value)}
            disabled={p.sending}
          >
            <option value="">{t("waiter.pickTable")}</option>
            {p.tables.map(x => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
          {/* For a waiter who has been shown to a table and does not know what
              the app calls it. The list is still there and still works; this
              is for the ones who have not learned thirty table names yet, on
              their first week. */}
          <QrScanner
            label={t("waiter.scan")}
            title={t("waiter.scanTitle")}
            hint={t("waiter.scanHint")}
            noCamera={t("scan.noCamera")}
            buttonClass="tt-btn tt-btn-ghost"
            onRead={raw => {
              const found = tableFromScan(raw);
              // A poster or a wifi card: keep looking, say nothing.
              if (!found) return "keep-looking";
              // Another venue's table decodes perfectly well. Pointing an
              // order at it is exactly what must not happen quietly — and the
              // route would refuse it anyway.
              if (found.restaurantId !== p.restaurantId) {
                return { problem: t("waiter.scanElsewhere") };
              }
              const known = p.tables.find(x => x.id === found.tableId);
              if (!known) return { problem: t("waiter.scanUnknown") };
              p.onTable(known.id);
              toast(t("waiter.scanned", { label: known.label }));
              return "taken";
            }}
          />
        </div>
      </label>

      {p.lines.length === 0 ? (
        <p className="tt-muted">{t("pos.empty")}</p>
      ) : (
        <div className="tt-pos-lines">
          {p.lines.map(line => (
            <CartLineRow
              key={line.cartId}
              item={line}
              currency={p.currency}
              imageUrl={p.items.find(i => i.id === line.itemId)?.image_url ?? null}
              onRemove={cartId => p.onChangeQty(cartId, 0)}
              onChangeQty={p.onChangeQty}
              onEdit={p.onEdit}
            />
          ))}
        </div>
      )}

      <label className="tt-field">
        <span className="tt-mod-label">{t("pos.note")}</span>
        <input
          className="tt-input"
          value={p.note}
          onChange={e => p.onNote(e.target.value)}
          placeholder={t("pos.noteHint")}
          disabled={p.sending}
        />
      </label>

      <div className="tt-pos-total">
        <span>{t("pos.total")}</span>
        <strong>{formatMoney(p.total, p.currency)}</strong>
      </div>

      {/* Nothing is charged here. The table settles at the end, which is what
          the bill screen is for. */}
      <p className="tt-muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
        {t("waiter.paysLater")}
      </p>

      <div className="tt-pos-charge">
        <button
          type="button"
          className="tt-btn tt-btn-primary"
          disabled={p.sending || p.closedNow || p.lines.length === 0 || !p.tableId}
          onClick={p.onSend}
        >
          {p.busy ? t("cart.placingOrder") : t("waiter.send")}
        </button>
      </div>
    </aside>
  );
}
