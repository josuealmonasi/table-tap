"use client";

import { remaining, type PlanLimits } from "@/lib/plan";
import { useT } from "@/lib/i18n/context";

export interface PlanUsageCounts {
  tables: number;
  staff: number;
  menus: number;
  items: number;
}

const ROWS = [
  { key: "tables", max: "max_tables", labelKey: "plan.usage.tables" },
  { key: "staff", max: "max_staff", labelKey: "plan.usage.staff" },
  { key: "menus", max: "max_menus", labelKey: "plan.usage.menus" },
  { key: "items", max: "max_items", labelKey: "plan.usage.items" },
] as const;

/**
 * What the restaurant has against what its tier allows.
 *
 * Answering "can I add another table?" before they find out by being refused
 * — which, until this screen existed, was the only way to learn a ceiling was
 * there at all.
 */
export default function PlanUsage({
  limits,
  usage,
}: {
  limits: PlanLimits;
  usage: PlanUsageCounts;
}) {
  const t = useT();

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("plan.usageTitle")}
        </h3>
      </div>

      <div className="tt-usage-list">
        {ROWS.map(row => {
          const used = usage[row.key];
          const max = limits[row.max];
          const left = remaining(used, max);
          const full = left === 0;
          // An unlimited row has nothing to fill, so it shows the count alone
          // rather than a bar that is permanently empty and means nothing.
          const pct = max && max > 0 ? Math.min(100, (used / max) * 100) : null;

          return (
            <div key={row.key} className="tt-usage-row">
              <div className="tt-row">
                <span>{t(row.labelKey)}</span>
                <span className={full ? "tt-usage-full" : "tt-muted"}>
                  {max === null
                    ? t("plan.usage.unlimited", { used })
                    : t("plan.usage.of", { used, max })}
                </span>
              </div>
              {pct !== null && (
                <div className="tt-usage-bar" aria-hidden="true">
                  <span
                    className={full ? "tt-usage-fill tt-usage-fill-full" : "tt-usage-fill"}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
