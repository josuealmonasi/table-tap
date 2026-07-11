"use client";

import { useConfirm } from "@/components/ui/ConfirmDialog";

interface BulkBarProps {
  count: number;
  onCancel: () => void;
  /** Deletes everything selected; called only after the user confirms. */
  onDelete: () => Promise<void>;
}

/** Floating toolbar shown in bulk-select mode: count, cancel, delete. */
export default function BulkBar({ count, onCancel, onDelete }: BulkBarProps) {
  const confirm = useConfirm();

  return (
    <div className="tt-bulk-bar" role="toolbar" aria-label="Bulk actions">
      <span style={{ fontSize: 14 }}>
        <strong>{count}</strong> selected
      </span>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="tt-btn tt-btn-ghost tt-btn-sm" onClick={onCancel}>Cancel</button>
        <button
          className="tt-btn tt-btn-primary tt-btn-sm"
          disabled={count === 0}
          onClick={async () => {
            if (
              await confirm({
                title: `Delete ${count} selected item${count === 1 ? "" : "s"}?`,
                message: "Products and extras are removed permanently. This can't be undone.",
                confirmLabel: "Delete selected",
                danger: true,
              })
            ) {
              await onDelete();
            }
          }}
        >
          🗑️ Delete selected
        </button>
      </div>
    </div>
  );
}
