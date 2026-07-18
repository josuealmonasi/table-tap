"use client";

import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useT } from "@/lib/i18n/context";

interface BulkBarProps {
  count: number;
  onCancel: () => void;
  /** Deletes everything selected; called only after the user confirms. */
  onDelete: () => Promise<void>;
}

/** Floating toolbar shown in bulk-select mode: count, cancel, delete. */
export default function BulkBar({ count, onCancel, onDelete }: BulkBarProps) {
  const t = useT();
  const confirm = useConfirm();

  return (
    <div className="tt-bulk-bar" role="toolbar" aria-label={t("menu.bulkActions")}>
      <span style={{ fontSize: 14 }}>
        <strong>{count}</strong> {t("menu.selected")}
      </span>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="tt-btn tt-btn-ghost tt-btn-sm" onClick={onCancel}>
          {t("menu.cancel")}
        </button>
        <button
          className="tt-btn tt-btn-primary tt-btn-sm"
          disabled={count === 0}
          onClick={async () => {
            if (
              await confirm({
                title: t("menu.deleteSelectedConfirm"),
                message: t("menu.deleteSelectedMsg"),
                confirmLabel: t("menu.deleteSelected"),
                danger: true,
              })
            ) {
              await onDelete();
            }
          }}
        >
          {t("menu.deleteSelected")}
        </button>
      </div>
    </div>
  );
}
