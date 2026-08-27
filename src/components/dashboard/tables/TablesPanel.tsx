"use client";

import { useMemo, useState } from "react";
import type { RestaurantTable } from "@/lib/types";
import { useTables } from "@/hooks/useTables";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import Breadcrumb from "@/components/layout/Breadcrumb";
import QrCard, { type QrTarget } from "./QrCard";
import TableRow from "./TableRow";
import { statusFor, type TableStatus } from "@/lib/table-status";
import { SearchIcon } from "@/components/ui/icons";
import { TableIcon } from "@/components/ui/icons";
import AddInDialog from "@/components/ui/AddInDialog";
import PlanLock from "@/components/dashboard/plan/PlanLock";
import { useLiveOrders } from "@/hooks/useLiveOrders";

/** A table paired with its pre-rendered QR (generated on the server). */
export interface TableWithQr {
  table: RestaurantTable;
  qr: QrTarget;
}

interface TablesPanelProps {
  restaurantId: string;
  restaurantName: string;
  fastFood: QrTarget;
  tables: TableWithQr[];
  /** Which tables are free, keyed by table id. */
  statuses: Record<string, TableStatus>;
  currency: string;
  /** Whether this tier includes table service at all. */
  tablesAllowed?: boolean;
  /** The cheapest tier that includes it. */
  tablesUnlockWith?: string;
}

/** Dashboard Tables & QR: one restaurant-wide QR plus a per-table QR manager. */
export default function TablesPanel({
  restaurantId,
  restaurantName,
  fastFood,
  tables,
  statuses,
  currency,
  tablesAllowed = true,
  tablesUnlockWith = "servicio",
}: TablesPanelProps) {
  const t = useT();
  const toast = useToast();
  // The page hands these over as a plain object, which a Map reads better.
  // `?? {}` rather than trusting the prop: a page served from a stale compile
  // sends the older set of props, and Object.entries(undefined) throws — which
  // takes the whole screen down instead of losing one badge.
  const statusMap = useMemo(() => new Map(Object.entries(statuses ?? {})), [statuses]);
  // Collecting on a table changes its label here, without a reload.
  useLiveOrders(restaurantId);
  const { busy, addTable, renameTable, deleteTable } = useTables(restaurantId);
  const [newLabel, setNewLabel] = useState("");

  async function submitAdd(e: React.FormEvent): Promise<boolean> {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label) return false;
    // Only claim it worked if it did. This used to confirm and close on the
    // way past, so a refused write — a plan ceiling, a dropped connection —
    // told the owner the table was added and threw away what they had typed.
    if (!(await addTable(label))) return false;
    setNewLabel("");
    toast(t("done.tableAdded"));
    return true;
  }

  const addForm = (close: () => void) => (
    <form
      className="tt-prodform"
      onSubmit={async e => {
        if (await submitAdd(e)) close();
      }}
    >
      <input
        className="tt-input"
        placeholder={t("dash.tableLabelPlaceholder")}
        value={newLabel}
        onChange={e => setNewLabel(e.target.value)}
      />
      <div className="tt-prodform-actions">
        <button
          className="tt-btn tt-btn-primary tt-btn-sm"
          type="submit"
          disabled={!newLabel.trim() || busy}
        >
          {t("dash.addTable")}
        </button>
      </div>
    </form>
  );

  // On a tier without table service the lock stands where the button would be.
  // The QR codes above it still work — the fast-food code is the whole point of
  // the free plan — so only the "add a table" half is replaced.
  const addTableDialog = tablesAllowed ? (
    <AddInDialog label={t("dash.addTable")} title={t("dash.addTable")} maxWidth={520}>
      {addForm}
    </AddInDialog>
  ) : (
    <PlanLock feature="dineIn" unlocksWith={tablesUnlockWith} />
  );

  // A dining room can run to fifty tables, and every card carries a QR the
  // size of a beer mat — finding "table 34" by scrolling means passing thirty
  // of them. Matches the label the way it is written on the table.
  const [query, setQuery] = useState("");
  const shownTables = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter(({ table }) => table.label.toLowerCase().includes(q));
  }, [tables, query]);

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[
              { labelKey: "nav.dashboard", href: "/dashboard" },
              { labelKey: "nav.tables" },
            ]}
          />
        </header>

        {/* Fast-food: one QR for the whole restaurant. */}
        <div className="tt-section">
          <div className="tt-section-head">
            <h3 className="tt-serif" style={{ margin: 0 }}>
              {t("dash.fastFoodQr")}
            </h3>
            <span className="tt-muted" style={{ fontSize: 12 }}>
              {t("dash.fastFoodHint")}
            </span>
          </div>
          <p className="tt-muted" style={{ fontSize: 13, marginTop: 0 }}>
            {t("dash.fastFoodDesc")}
          </p>
          <QrCard
            title={restaurantName}
            subtitle={t("dash.wholeRestaurant")}
            qr={fastFood}
            downloadName="restaurant-qr"
          />
        </div>

        {/* Table service: one QR per table. */}
        <div className="tt-section">
          <div className="tt-section-head">
            <h3 className="tt-serif" style={{ margin: 0 }}>
              {t("dash.tableQrs")}
            </h3>
            <span className="tt-muted" style={{ fontSize: 12 }}>
              {t("dash.tableQrsHint")}
            </span>
          </div>

          {tables.length === 0 ? (
            <div className="tt-empty">
              <TableIcon size={40} className="tt-empty-icon" />
              <strong>{t("dash.addFirstTable")}</strong>
              <p
                className="tt-muted"
                style={{ fontSize: 13, margin: "4px 0 14px", maxWidth: 360 }}
              >
                {t("dash.addFirstTableDesc")}
              </p>
              {addTableDialog}
            </div>
          ) : (
            <>
              {/* Above the list: with a room full of tables you shouldn't have
                  to scroll past every QR code to add one more. */}
              {addTableDialog}

              {/* Always here, not only past some number of tables: a control
                  that appears when the data does is a control the skeleton
                  can't reserve room for, and the list jumps when it arrives. */}
              <div className="tt-bill-search" style={{ marginBottom: 14 }}>
                  <SearchIcon size={16} weight="bold" />
                  <input
                    className="tt-input"
                    value={query}
                    placeholder={t("dash.tableSearch")}
                    aria-label={t("dash.tableSearch")}
                  onChange={e => setQuery(e.target.value)}
                />
              </div>

              {shownTables.length === 0 ? (
                <p className="tt-muted" style={{ margin: "4px 0" }}>
                  {t("dash.tableSearchEmpty", { query: query.trim() })}
                </p>
              ) : (
              <div className="tt-table-list">
                {shownTables.map(({ table, qr }) => (
                  <TableRow
                    key={table.id}
                    table={table}
                    qr={qr}
                    status={statusFor(statusMap, table.id)}
                    currency={currency}
                    onRename={renameTable}
                    onDelete={deleteTable}
                  />
                ))}
              </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
