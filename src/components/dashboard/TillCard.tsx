"use client";

import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import type { Till } from "@/lib/till";

/**
 * What this person has collected today, on the screen where they collect it.
 *
 * Their own total, not the restaurant's: a waiter counting their takings has
 * no need of the day's revenue, and management already has that figure on the
 * orders board. Cash is called out because it is the part that has to match
 * what is physically in the drawer at the end of a shift.
 */
export default function TillCard({ till, currency }: { till: Till; currency: string }) {
  const t = useT();
  return (
    <div className="tt-section tt-till">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("till.title")}
        </h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>
          {t("till.hint")}
        </span>
      </div>

      {till.count === 0 ? (
        <p className="tt-muted" style={{ fontSize: 13, margin: "8px 0 0" }}>
          {t("till.empty")}
        </p>
      ) : (
        <div className="tt-till-figures">
          <div className="tt-till-main">
            <strong>{formatMoney(till.total, currency)}</strong>
            <span className="tt-muted">{t("till.count", { n: till.count })}</span>
          </div>
          <div className="tt-till-split">
            <span>
              {t("till.cash")} <strong>{formatMoney(till.cash, currency)}</strong>
            </span>
            <span>
              {t("till.card")} <strong>{formatMoney(till.card, currency)}</strong>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
