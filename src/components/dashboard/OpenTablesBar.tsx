"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { openTables, type OpenTable } from "@/lib/table-bill";
import { BillIcon, SearchIcon } from "@/components/ui/icons";
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
  const [query, setQuery] = useState("");
  const tables = openTables(orders);

  if (tables.length === 0) return null;

  // A busy floor can have twenty tables owing at once, and the one being
  // asked about is rarely the one on top.
  const q = query.trim().toLowerCase();
  const shown = q
    ? tables.filter(table => table.tableLabel.toLowerCase().includes(q))
    : tables;
  const owed = shown.reduce((sum, table) => sum + table.total, 0);

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

      <div className="tt-bill-search" style={{ marginTop: 10 }}>
        <SearchIcon size={15} weight="bold" />
        <input
          className="tt-input"
          value={query}
          placeholder={t("settle.searchTables")}
          aria-label={t("settle.searchTables")}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      <div className="tt-open-tables-list">
        {shown.map(table => (
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
