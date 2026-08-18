"use client";

import { useState } from "react";
import type { RestaurantTable } from "@/lib/types";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import QrCard, { type QrTarget } from "./QrCard";
import { DeleteIcon, EditIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/Modal";

interface TableRowProps {
  table: RestaurantTable;
  qr: QrTarget;
  /** Both report whether the write landed; the row only cares that it finished. */
  onRename: (id: string, label: string) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}

/** One table: its QR plus rename (inline) and delete (confirmed) actions. */
export default function TableRow({ table, qr, onRename, onDelete }: TableRowProps) {
  const t = useT();
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(table.label);
  const confirm = useConfirm();

  async function remove(): Promise<void> {
    const ok = await confirm({
      title: t("dash.deleteTableConfirm", { label: table.label }),
      message: t("dash.deleteTableMsg"),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (ok) await onDelete(table.id);
  }

  return (
    <div className="tt-table-row">
      <QrCard
        title={t("dash.tableN", { label: table.label })}
        subtitle={t("dash.orderTagged")}
        qr={qr}
        downloadName={`table-${table.label}`}
      />
      <div className="tt-table-actions">
        <Modal
          open={renaming}
          onClose={() => {
            setValue(table.label);
            setRenaming(false);
          }}
          maxWidth={460}
          title={t("common.editingNamed", { name: table.label })}
        >
          <form
            className="tt-prodform"
            onSubmit={async e => {
              e.preventDefault();
              const label = value.trim();
              if (label && label !== table.label) {
                await onRename(table.id, label);
                toast(t("done.tableRenamed"));
              }
              setRenaming(false);
            }}
          >
            <input
              className="tt-input"
              value={value}
              onChange={e => setValue(e.target.value)}
              autoFocus
            />
            <div className="tt-prodform-actions">
              <button
                className="tt-btn tt-btn-primary tt-btn-sm"
                type="submit"
                disabled={!value.trim() || value.trim() === table.label}
              >
                {t("dash.saveShort")}
              </button>
              <button
                type="button"
                className="tt-btn tt-btn-ghost tt-btn-sm"
                onClick={() => {
                  setValue(table.label);
                  setRenaming(false);
                }}
              >
                {t("common.cancel")}
              </button>
            </div>
          </form>
        </Modal>

        <div className="tt-prod-actions">
          <button
            className="tt-iconbtn"
            title={t("dash.rename")}
            onClick={() => setRenaming(true)}
          >
            <EditIcon size={16} />
          </button>
          <button className="tt-iconbtn" title={t("dash.deleteTable")} onClick={remove}>
            <DeleteIcon size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
