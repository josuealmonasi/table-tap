"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import { orderCode, type Order } from "@/lib/types";
import { statusMeta } from "@/lib/order-status";
import { useOrderHistory } from "@/hooks/useOrderHistory";
import { useT } from "@/lib/i18n/context";
import { LogRowsSkeleton } from "@/components/ui/DashSkeletons";
import { SearchIcon } from "@/components/ui/icons";
import OrderDetailDialog from "./OrderDetailDialog";

/** What was on the order, short enough to sit on one line. */
function summarise(order: Order): string {
  return (order.items ?? [])
    .map(i => `${i.qty}× ${i.name}`)
    .join(" · ");
}

/**
 * Orders the restaurant has finished with: searchable, ten at a time.
 *
 * A list rather than the cards the live board uses, because these are browsed
 * and looked up, not worked — and as a grid of cards it had grown to a wall
 * nobody could find anything in. Searching by the code on the ticket is the
 * way anyone actually looks for one of these.
 */
export default function OrderHistory({
  restaurantId,
  currency,
}: {
  restaurantId: string;
  currency: string;
}) {
  const t = useT();
  const { orders, loading, page, pages, total, setPage, query, setQuery } =
    useOrderHistory(restaurantId);
  const [open, setOpen] = useState<Order | null>(null);

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("orders.history")}
        </h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>
          {/* "1 pedidos" is the kind of thing that makes an app feel unfinished. */}
          {total === 1 ? t("orders.historyCountOne") : t("orders.historyCount", { total })}
        </span>
      </div>

      <div className="tt-bill-search">
        <SearchIcon size={15} weight="bold" />
        <input
          className="tt-input"
          value={query}
          placeholder={t("orders.historySearch")}
          aria-label={t("orders.historySearch")}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {loading && <LogRowsSkeleton rows={6} />}

      {!loading && orders.length === 0 && (
        <p className="tt-muted" style={{ fontSize: 13, margin: "12px 0 0" }}>
          {query ? t("orders.historyNoMatch", { query }) : t("orders.noPast")}
        </p>
      )}

      {!loading &&
        orders.map(order => (
          <button
            key={order.id}
            type="button"
            className="tt-log-row tt-hist-row"
            onClick={() => setOpen(order)}
          >
            <span className="tt-log-text">
              <span className="tt-log-line">
                {/* The same name and colour the board gives this stage —
                    two screens must not disagree about what an order is. */}
                <span
                  className="tt-hist-tag"
                  style={{ color: statusMeta(order.status).color }}
                >
                  {t(statusMeta(order.status).labelKey)}
                </span>
                <span>
                  <strong>{orderCode(order.id)}</strong>
                  {order.table_label && ` · ${t("dash.tableN", { label: order.table_label })}`}
                </span>
              </span>
              <span className="tt-log-detail">{summarise(order)}</span>
            </span>
            <span className="tt-hist-right">
              <strong>{formatMoney(order.total, currency)}</strong>
              {/* A promotion that was applied stays visible in the list, so a
                  discounted night can be found without opening every ticket. */}
              {Number(order.discount ?? 0) > 0 && (
                <span className="tt-save" style={{ fontSize: 12 }}>
                  −{formatMoney(Number(order.discount), currency)}
                </span>
              )}
              <span className="tt-log-when">
                {new Date(order.created_at).toLocaleString([], {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </span>
          </button>
        ))}

      {pages > 1 && (
        <div className="tt-log-pager">
          <button
            className="tt-btn tt-btn-ghost tt-btn-sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {t("dash.newer")}
          </button>
          <span className="tt-muted" style={{ fontSize: 13 }}>
            {t("dash.pageOf", { page, pages })}
          </span>
          <button
            className="tt-btn tt-btn-ghost tt-btn-sm"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            {t("dash.older")}
          </button>
        </div>
      )}

      {open && (
        <OrderDetailDialog
          order={open}
          currency={currency}
          open={Boolean(open)}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
