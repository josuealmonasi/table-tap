"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { openTables, type OpenTable } from "@/lib/table-bill";
import { BillIcon } from "@/components/ui/icons";
import SettleTableDialog from "./SettleTableDialog";
import type { Order } from "@/lib/types";

interface OpenTablesBarProps {
  restaurantId: string;
  currency: string;
  /** The board's orders; the unpaid, table-scoped ones become the debts. */
  orders: Order[];
  onSettled: () => void;
}

/**
 * Which tables still owe money.
 *
 * The board answers "what is the kitchen cooking". This answers "who hasn't
 * paid", which is the question a manager asks on a busy floor and could
 * previously only be answered by opening tables one at a time. Longest wait
 * first, because that is the table most likely to walk.
 *
 * Renders nothing when nothing is owed, so a restaurant that takes payment up
 * front never sees it.
 */
export default function OpenTablesBar({
  restaurantId,
  currency,
  orders,
  onSettled,
}: OpenTablesBarProps) {
  const t = useT();
  const [settling, setSettling] = useState<OpenTable | null>(null);
  const tables = openTables(orders);

  if (tables.length === 0) return null;

  const owed = tables.reduce((sum, table) => sum + table.total, 0);

  return (
    <section className="tt-open-tables">
      <div className="tt-row tt-open-tables-head">
        <strong>
          <BillIcon size={15} weight="bold" /> {t("settle.openTables")}
        </strong>
        <strong className="tt-accent">{formatMoney(owed, currency)}</strong>
      </div>
      <span className="tt-muted" style={{ fontSize: 12 }}>
        {t("settle.openTablesHint")}
      </span>

      <div className="tt-open-tables-list">
        {tables.map(table => (
          <button
            key={table.tableId}
            type="button"
            className="tt-open-table"
            onClick={() => setSettling(table)}
          >
            <span>
              <strong>{t("dash.tableN", { label: table.tableLabel })}</strong>
              <span className="tt-muted tt-subline" style={{ fontSize: 12, display: "block" }}>
                {t(table.orderCount === 1 ? "settle.tableOwes" : "settle.tableOwesPlural", {
                  n: table.orderCount,
                  amount: formatMoney(table.total, currency),
                })}
              </span>
            </span>
            <span className="tt-btn tt-btn-ghost tt-btn-sm">{t("settle.open")}</span>
          </button>
        ))}
      </div>

      {settling && (
        <SettleTableDialog
          open
          onClose={() => setSettling(null)}
          restaurantId={restaurantId}
          tableId={settling.tableId}
          tableLabel={settling.tableLabel}
          currency={currency}
          onSettled={onSettled}
        />
      )}
    </section>
  );
}
