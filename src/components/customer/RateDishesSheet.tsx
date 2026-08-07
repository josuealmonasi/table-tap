"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import type { RateableDish } from "@/lib/ratings";
import StarRating from "./StarRating";

/**
 * Asks the diner to rate what they ate, after they've asked for the bill.
 *
 * Entirely optional and never in the way: dismissing it is one tap, nothing is
 * required, and it appears after the bill request has already been sent so it
 * can't delay the thing they actually asked for. Partial answers are fine —
 * whatever's scored gets saved, the rest simply stays unrated.
 */
export default function RateDishesSheet({
  open,
  dishes,
  restaurantId,
  onClose,
}: {
  open: boolean;
  dishes: RateableDish[];
  restaurantId: string;
  onClose: () => void;
}) {
  const t = useT();
  const [scores, setScores] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  const key = (d: RateableDish) => `${d.orderId}:${d.itemId}`;
  const scored = dishes.filter(d => scores[key(d)]);

  async function submit() {
    if (scored.length === 0) return onClose();
    setSaving(true);
    try {
      await fetch("/api/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantId,
          ratings: scored.map(d => ({
            itemId: d.itemId,
            orderId: d.orderId,
            rating: scores[key(d)],
          })),
        }),
      });
    } catch {
      // A rating is not worth an error screen at the end of a meal. The bill
      // was already requested; losing an opinion to a flaky connection is the
      // cheapest possible failure here.
    }
    setSaving(false);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} label={t("rating.title")} variant="sheet">
      <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 4 }}>
        {t("rating.title")}
      </h3>
      <p className="tt-muted" style={{ marginTop: 0, fontSize: 14 }}>
        {t("rating.subtitle")}
      </p>

      <div className="tt-rate-list">
        {dishes.map(dish => (
          <div key={key(dish)} className="tt-rate-row">
            <span className="tt-rate-dish">
              <span className="tt-rate-emoji">{dish.emoji || "🍽️"}</span>
              {dish.name}
            </span>
            <StarRating
              value={scores[key(dish)] ?? 0}
              label={t("rating.rateDish", { name: dish.name })}
              onChange={n => setScores(prev => ({ ...prev, [key(dish)]: n }))}
            />
          </div>
        ))}
      </div>

      <div className="tt-rate-actions">
        <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={onClose}>
          {t("rating.skip")}
        </button>
        <button
          type="button"
          className="tt-btn tt-btn-primary tt-btn-sm"
          disabled={saving}
          onClick={submit}
        >
          {saving
            ? t("common.saving")
            : scored.length > 1
              ? t("rating.submitMany", { count: scored.length })
              : t("rating.submit")}
        </button>
      </div>
    </Modal>
  );
}
