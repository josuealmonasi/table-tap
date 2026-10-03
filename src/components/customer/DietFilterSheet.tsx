"use client";

import { Modal } from "@/components/ui/Modal";
import { useLocale, useT } from "@/lib/i18n/context";
import { tagLabel, type DietaryTag } from "@/lib/dietary";

interface DietFilterSheetProps {
  open: boolean;
  onClose: () => void;
  tags: DietaryTag[];
  diet: string[];
  onToggle: (key: string) => void;
  onClear: () => void;
}

/** The dietary filter on a phone: a sheet behind one button, not a third of the screen. */
export default function DietFilterSheet({
  open,
  onClose,
  tags,
  diet,
  onToggle,
  onClear,
}: DietFilterSheetProps) {
  const t = useT();
  const { locale: lang } = useLocale();
  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth={420}
      label={t("menu.filtersTitle")}
      variant="sheet"
    >
      <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 12 }}>
        {t("menu.filtersTitle")}
      </h3>
      <div className="tt-diet-filter">
        {tags.map(tag => (
          <button
            key={tag.key}
            type="button"
            className={`tt-diet-chip ${diet.includes(tag.key) ? "tt-diet-chip-on" : ""}`}
            aria-pressed={diet.includes(tag.key)}
            onClick={() => onToggle(tag.key)}
          >
            {tag.emoji} {tagLabel(tag, t, lang)}
          </button>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          marginTop: 18,
        }}
      >
        <button
          type="button"
          className="tt-btn tt-btn-ghost tt-btn-sm"
          disabled={diet.length === 0}
          // Clearing leaves nothing to look at, so the sheet closes with it —
          // staying open just to show empty checkboxes makes the diner tap
          // twice to get back to the food.
          onClick={() => {
            onClear();
            onClose();
          }}
        >
          {t("menu.filtersClear")}
        </button>
        <button
          type="button"
          className="tt-btn tt-btn-primary tt-btn-sm"
          onClick={onClose}
        >
          {t("menu.filtersDone")}
        </button>
      </div>
    </Modal>
  );
}
