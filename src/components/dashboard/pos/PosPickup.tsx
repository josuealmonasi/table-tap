"use client";

import { useT } from "@/lib/i18n/context";
import type { ReadyTable } from "@/lib/ready-tables";

interface PosPickupProps {
  ready: ReadyTable[];
  onHandOver: (pickup: ReadyTable) => void;
}

/**
 * Counter orders the kitchen has called ready, by the code on the customer's
 * ticket — the number the cashier calls out. A tap means it went over the
 * counter. Longest wait first.
 */
export default function PosPickup({ ready, onHandOver }: PosPickupProps) {
  const t = useT();
  if (ready.length === 0) return null;
  return (
    <div className="tt-pos-pickup" role="region" aria-label={t("pos.pickupTitle")}>
      <strong className="tt-pos-pickup-title">{t("pos.pickupTitle")}</strong>
      <div className="tt-pos-pickup-list">
        {ready.map(pickup => (
          <button
            type="button"
            key={pickup.key}
            className="tt-pos-pickup-chip"
            onClick={() => onHandOver(pickup)}
            title={t("pos.pickupHandOver")}
          >
            <span className="tt-pos-pickup-code">{pickup.code}</span>
            {pickup.customerName && <span>{pickup.customerName}</span>}
            <span className="tt-muted">{t("pos.pickupDishes", { n: pickup.dishes })}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
