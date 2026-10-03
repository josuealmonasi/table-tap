"use client";

import { formatMoney } from "@/lib/format";
import type { MenuItem } from "@/lib/types";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useT } from "@/lib/i18n/context";
import ReorderButtons from "@/components/ui/ReorderButtons";
import { DeleteIcon, EditIcon } from "@/components/ui/icons";

interface AddonRowProps {
  addon: MenuItem;
  currency: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Bulk-select mode shows a checkbox in place of the reorder arrows. */
  selectable: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onToggleAvailable: (available: boolean) => void;
  onMove: (direction: "up" | "down") => void;
  onDelete: () => void;
}

/** One extra: its order, its name and price, whether it is on offer, and edit or delete. */
export default function AddonRow({
  addon,
  currency,
  canMoveUp,
  canMoveDown,
  selectable,
  selected,
  onToggleSelect,
  onEdit,
  onToggleAvailable,
  onMove,
  onDelete,
}: AddonRowProps) {
  const t = useT();
  const confirm = useConfirm();
  return (
    <div
      className={`tt-prod ${addon.available ? "" : "tt-prod-off"} ${selected ? "tt-prod-selected" : ""}`}
    >
      {selectable ? (
        <input
          type="checkbox"
          className="tt-bulk-check"
          checked={selected}
          aria-label={t("menu.selectItem", { name: addon.name })}
          onChange={onToggleSelect}
        />
      ) : (
        <ReorderButtons
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onMoveUp={() => onMove("up")}
          onMoveDown={() => onMove("down")}
        />
      )}
      <div className="tt-prod-body">
        <div className="tt-prod-thumb">
          <span>{addon.emoji || addon.name.charAt(0).toUpperCase()}</span>
        </div>
        <div style={{ flex: 1 }}>
          {/* The name opens the editor, the same as on a product: the
                pencil is still there, but nobody hunts for it when the
                thing they want to change is what they are reading. Same
                class, so it behaves the same and there is no second
                style to maintain. */}
          <button
            type="button"
            className="tt-prod-name"
            onClick={onEdit}
            title={t("menu.edit")}
          >
            {addon.name}
          </button>
          {!addon.available && (
            <span className="tt-badge" style={{ marginLeft: 6 }}>
              {t("menu.unavailable")}
            </span>
          )}
        </div>
        <div className="tt-prod-right">
          <strong className="tt-accent">{formatMoney(addon.price, currency)}</strong>
          <label
            className="tt-switch"
            title={t(addon.available ? "menu.available" : "menu.unavailable")}
          >
            <input
              type="checkbox"
              aria-label={t(addon.available ? "menu.available" : "menu.unavailable")}
              checked={addon.available}
              onChange={e => onToggleAvailable(e.target.checked)}
            />
            <span className="tt-switch-track" />
          </label>
          <div className="tt-prod-actions">
            <button className="tt-iconbtn" title={t("menu.edit")} onClick={onEdit}>
              <EditIcon size={16} />
            </button>
            <button
              className="tt-iconbtn"
              title={t("menu.delete")}
              onClick={async () => {
                if (
                  await confirm({
                    title: t("menu.deleteExtraConfirm", { name: addon.name }),
                    confirmLabel: t("menu.delete"),
                    danger: true,
                  })
                ) {
                  onDelete();
                }
              }}
            >
              <DeleteIcon size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
