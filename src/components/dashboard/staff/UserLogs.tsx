"use client";

import { useMemo, useState } from "react";
import { useUserLogs } from "@/hooks/useUserLogs";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { LogRowsSkeleton } from "@/components/ui/DashSkeletons";
import { MoveDownIcon, MoveUpIcon, SearchIcon } from "@/components/ui/icons";
import { entitiesNamedBy, parseLogDetail } from "@/lib/log-detail";

interface UserLogsProps {
  restaurantId: string;
  /** Amounts are recorded as bare numbers; the reader wants them as money. */
  currency: string;
}

/**
 * The restaurant's activity log: who did what, and when.
 *
 * An owner comes here with a question — "who wrote that bill off on Friday",
 * "when did the IVA change" — so the list is searchable and can be ordered by
 * either the kind of action or the time it happened. Twelve to a page, which
 * fits a laptop screen without the table scrolling out of view.
 */
export default function UserLogs({ restaurantId, currency }: UserLogsProps) {
  const t = useT();
  // Lo que se escribe se compara contra lo que se lee en las filas, no contra
  // el nombre inglés que hay en la columna.
  const [typed, setTyped] = useState("");
  const named = useMemo(
    () => entitiesNamedBy(typed, entity => t(`log.entity.${entity}`)),
    [typed, t],
  );
  const {
    logs,
    loading,
    page,
    pages,
    total,
    setPage,
    query,
    setQuery,
    sort,
    ascending,
    sortBy,
  } = useUserLogs(restaurantId, named);

  /**
   * The specifics, in the reader's language: the server wrote them as fields
   * because it had no way of knowing who would read them.
   */
  const specifics = (log: (typeof logs)[number]): string => {
    const fields = parseLogDetail(log.detail);
    if (!fields) return log.detail ?? log.target_email ?? "";
    const parts: string[] = [];
    if (fields.table) parts.push(t("dash.tableN", { label: fields.table }));
    if (fields.code) parts.push(fields.code);
    if (fields.orders) parts.push(t("dash.logOrders", { n: fields.orders }));
    if (fields.amount) parts.push(formatMoney(Number(fields.amount), currency));
    if (fields.method) parts.push(t(`dash.pay${fields.method}`));
    if (fields.order) parts.push(`#${fields.order}`);
    for (const [key, value] of Object.entries(fields)) {
      if (!["table", "code", "orders", "amount", "method", "order"].includes(key)) {
        parts.push(`${key}: ${value}`);
      }
    }
    return parts.join(" · ");
  };

  /** "wrote off a bill", "changed a setting" — in the reader's language. */
  const describe = (log: (typeof logs)[number]): string => {
    const key = `log.${log.entity}.${log.action}`;
    const line = t(key);
    // A combination we haven't named yet reads as plain words rather than a
    // key: the log is a record first, and must never show its own internals.
    return line === key ? `${t(`log.entity.${log.entity}`)} · ${log.action}` : line;
  };

  /** Only the active column shows a direction; the other is just a label. */
  const Arrow = ({ column }: { column: typeof sort }) =>
    sort !== column ? null : ascending ? (
      <MoveUpIcon size={13} weight="bold" />
    ) : (
      <MoveDownIcon size={13} weight="bold" />
    );

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("dash.recentActivity")}
        </h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>
          {t("dash.activityCount", { n: total })}
        </span>
      </div>
      <p className="tt-muted" style={{ fontSize: 13, marginTop: 0 }}>
        {t("dash.activityHint")}
      </p>

      <div className="tt-bill-search">
        <SearchIcon size={15} weight="bold" />
        <input
          className="tt-input"
          value={query}
          placeholder={t("dash.activitySearch")}
          aria-label={t("dash.activitySearch")}
          onChange={e => {
            setQuery(e.target.value);
            setTyped(e.target.value);
          }}
        />
      </div>

      <div className="tt-log-sort">
        <button
          type="button"
          className={`tt-sort-btn ${sort === "action" ? "tt-sort-on" : ""}`}
          aria-pressed={sort === "action"}
          onClick={() => sortBy("action")}
        >
          {t("dash.sortByAction")} <Arrow column="action" />
        </button>
        <button
          type="button"
          className={`tt-sort-btn ${sort === "created_at" ? "tt-sort-on" : ""}`}
          aria-pressed={sort === "created_at"}
          onClick={() => sortBy("created_at")}
        >
          {t("dash.sortByDate")} <Arrow column="created_at" />
        </button>
      </div>

      {loading && <LogRowsSkeleton rows={6} />}
      {!loading && logs.length === 0 && (
        <p className="tt-muted" style={{ fontSize: 13, margin: "12px 0 0" }}>
          {query ? t("dash.logsNoMatch", { query }) : t("dash.logsEmpty")}
        </p>
      )}

      {!loading &&
        logs.map(l => (
          <div key={l.id} className="tt-log-row">
            <span className="tt-log-text">
              {/* The sentence on one line, the specifics under it: they were
                  running together into a paragraph that wrapped into the
                  timestamp. */}
              <span className="tt-log-line">
                <span className={`tt-log-tag tt-log-${l.entity}`}>
                  {t(`log.entity.${l.entity}`)}
                </span>
                <span>
                  <strong>{l.actor_email}</strong> {describe(l)}
                </span>
              </span>
              {specifics(l) && <span className="tt-log-detail">{specifics(l)}</span>}
            </span>
            <span className="tt-log-when">
              {new Date(l.created_at).toLocaleString([], {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
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
    </div>
  );
}
