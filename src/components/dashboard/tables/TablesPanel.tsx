"use client";

import { useState } from "react";
import type { RestaurantTable } from "@/lib/types";
import { useTables } from "@/hooks/useTables";
import { useT } from "@/lib/i18n/context";
import Breadcrumb from "@/components/layout/Breadcrumb";
import QrCard, { type QrTarget } from "./QrCard";
import TableRow from "./TableRow";

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
}

/** Dashboard Tables & QR: one restaurant-wide QR plus a per-table QR manager. */
export default function TablesPanel({
  restaurantId,
  restaurantName,
  fastFood,
  tables,
}: TablesPanelProps) {
  const t = useT();
  const { busy, addTable, renameTable, deleteTable } = useTables(restaurantId);
  const [newLabel, setNewLabel] = useState("");

  async function submitAdd(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label) return;
    await addTable(label);
    setNewLabel("");
  }

  const addForm = (
    <form className="tt-add-section" onSubmit={submitAdd}>
      <input
        className="tt-input"
        placeholder={t("dash.tableLabelPlaceholder")}
        value={newLabel}
        onChange={e => setNewLabel(e.target.value)}
      />
      <button
        className="tt-btn tt-btn-primary"
        type="submit"
        disabled={!newLabel.trim() || busy}
      >
        {t("dash.addTable")}
      </button>
    </form>
  );

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
        <div className="tt-section" style={{ marginTop: 16 }}>
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
              <div className="tt-empty-emoji">🪑</div>
              <strong>{t("dash.addFirstTable")}</strong>
              <p
                className="tt-muted"
                style={{ fontSize: 13, margin: "4px 0 14px", maxWidth: 360 }}
              >
                {t("dash.addFirstTableDesc")}
              </p>
              {addForm}
            </div>
          ) : (
            <>
              <div className="tt-table-list">
                {tables.map(({ table, qr }) => (
                  <TableRow
                    key={table.id}
                    table={table}
                    qr={qr}
                    onRename={renameTable}
                    onDelete={deleteTable}
                  />
                ))}
              </div>
              <div style={{ marginTop: 12 }}>{addForm}</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
