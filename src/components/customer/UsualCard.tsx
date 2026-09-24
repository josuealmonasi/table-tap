"use client";

import { useT } from "@/lib/i18n/context";
import type { OrderLineItem } from "@/lib/types";

interface UsualCardProps {
  /** What this phone usually orders here, as today's menu can still make it. */
  lines: OrderLineItem[];
  onAdd: () => void;
  onForget: () => void;
}

/** "2× 🥬 Coleslaw · Guacamole · Salsa: Verde · “sin cebolla”" */
function describe(line: OrderLineItem): string {
  const parts = [
    ...(line.extras ?? []).map(e => e.name),
    ...Object.entries(line.mods ?? {}).map(([label, v]) => `${label}: ${Array.isArray(v) ? v.join(", ") : v}`),
    ...(line.notes ? [`“${line.notes}”`] : []),
  ];
  return [`${line.qty}× ${line.emoji} ${line.name}`, ...parts].join(" · ");
}

/**
 * "Lo de siempre", one tap away: the lines this phone orders here most, each
 * exactly as it was ordered. No total on purpose — promotions and the table's
 * own charges are priced in the cart, and a number here that the cart then
 * changed would be a promise the cart breaks.
 */
export default function UsualCard({ lines, onAdd, onForget }: UsualCardProps) {
  const t = useT();
  return (
    <section className="tt-usual" aria-label={t("usual.title")}>
      <div className="tt-usual-head">
        <strong>{t("usual.title")}</strong>
        <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={onForget}>
          {t("usual.forget")}
        </button>
      </div>
      <p className="tt-muted tt-usual-hint">{t("usual.hint")}</p>
      <ul className="tt-usual-lines">
        {lines.map(line => (
          <li key={JSON.stringify([line.itemId, line.extras?.map(e => e.id), line.mods, line.notes])}>
            {describe(line)}
          </li>
        ))}
      </ul>
      <button type="button" className="tt-btn tt-btn-primary" onClick={onAdd}>
        {t("usual.add")}
      </button>
    </section>
  );
}
