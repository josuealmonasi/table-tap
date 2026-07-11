"use client";

interface ReorderButtonsProps {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

/** Stacked ▲▼ buttons for moving a row up/down within its sibling group. */
export default function ReorderButtons({
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: ReorderButtonsProps) {
  // Nothing to reorder when this is the only item in its group.
  if (!canMoveUp && !canMoveDown) return null;

  return (
    <div className="tt-reorder">
      <button
        type="button"
        className="tt-reorder-btn"
        title="Move up"
        disabled={!canMoveUp}
        onClick={onMoveUp}
      >
        ▲
      </button>
      <button
        type="button"
        className="tt-reorder-btn"
        title="Move down"
        disabled={!canMoveDown}
        onClick={onMoveDown}
      >
        ▼
      </button>
    </div>
  );
}
