"use client";

import { RatingIcon } from "@/components/ui/icons";
import { useT } from "@/lib/i18n/context";

/**
 * A 1–5 star control, or a read-only score when `onChange` is omitted.
 *
 * Rendered as real buttons rather than a radio group so each star is reachable
 * by keyboard and announces what picking it means — "Rate 4 of 5" says more to
 * a screen reader than a star glyph does.
 */
export default function StarRating({
  value,
  onChange,
  size = 28,
  label,
}: {
  value: number;
  onChange?: (rating: number) => void;
  size?: number;
  /** Names what's being rated, so the buttons aren't five identical "4 of 5"s. */
  label?: string;
}) {
  const t = useT();
  const readOnly = !onChange;

  return (
    <div
      className="tt-stars"
      role={readOnly ? "img" : "group"}
      aria-label={
        readOnly ? t("rating.scoreOf", { score: value }) : (label ?? t("rating.rate"))
      }
    >
      {[1, 2, 3, 4, 5].map(star => {
        const on = star <= value;
        const glyph = (
          <RatingIcon
            size={size}
            weight={on ? "fill" : "regular"}
            className={on ? "tt-star-on" : "tt-star-off"}
          />
        );
        if (readOnly) return <span key={star}>{glyph}</span>;
        return (
          <button
            key={star}
            type="button"
            className="tt-star-btn"
            aria-label={t("rating.rateN", { n: star })}
            aria-pressed={on}
            onClick={() => onChange(star)}
          >
            {glyph}
          </button>
        );
      })}
    </div>
  );
}
