"use client";

import { useState } from "react";
import type { RestaurantTable } from "@/lib/types";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import QrCard, { type QrTarget } from "./QrCard";

interface TableRowProps {
  table: RestaurantTable;
  qr: QrTarget;
  onRename: (id: string, label: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

/** One table: its QR plus rename (inline) and delete (confirmed) actions. */
export default function TableRow({ table, qr, onRename, onDelete }: TableRowProps) {
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(table.label);
  const confirm = useConfirm();

  async function remove(): Promise<void> {
    const ok = await confirm({
      title: `Delete table “${table.label}”?`,
      message: "Its QR code will stop working. Existing orders keep their table label.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) await onDelete(table.id);
  }

  return (
    <div className="tt-table-row">
      <QrCard
        title={`Table ${table.label}`}
        subtitle="Order tagged to this table"
        qr={qr}
        downloadName={`table-${table.label}`}
      />
      <div className="tt-table-actions">
        {renaming ? (
          <form
            className="tt-add-section"
            onSubmit={async e => {
              e.preventDefault();
              const label = value.trim();
              if (label && label !== table.label) await onRename(table.id, label);
              setRenaming(false);
            }}
          >
            <input
              className="tt-input"
              value={value}
              onChange={e => setValue(e.target.value)}
              autoFocus
            />
            <button className="tt-btn tt-btn-primary tt-btn-sm" type="submit">
              Save
            </button>
            <button
              type="button"
              className="tt-btn tt-btn-ghost tt-btn-sm"
              onClick={() => {
                setValue(table.label);
                setRenaming(false);
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <div className="tt-prod-actions">
            <button
              className="tt-iconbtn"
              title="Rename"
              onClick={() => setRenaming(true)}
            >
              ✏️
            </button>
            <button className="tt-iconbtn" title="Delete table" onClick={remove}>
              🗑️
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
