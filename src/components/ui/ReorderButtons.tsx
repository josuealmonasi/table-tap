"use client";

import { useT } from "@/lib/i18n/context";
import { Icon } from "@/components/ui/icons";

interface ReorderButtonsProps {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

/** Stacked up/down buttons for moving a row within its sibling group. */
export default function ReorderButtons({
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: ReorderButtonsProps) {
  const t = useT();
  // Nothing to reorder when this is the only item in its group.
  if (!canMoveUp && !canMoveDown) return null;

  return (
    <div className="tt-reorder">
      <button
        type="button"
        className="tt-reorder-btn"
        title={t("menu.moveUp")}
        disabled={!canMoveUp}
        onClick={onMoveUp}
      >
        <Icon.MoveUp size={13} weight="bold" />
      </button>
      <button
        type="button"
        className="tt-reorder-btn"
        title={t("menu.moveDown")}
        disabled={!canMoveDown}
        onClick={onMoveDown}
      >
        <Icon.MoveDown size={13} weight="bold" />
      </button>
    </div>
  );
}
