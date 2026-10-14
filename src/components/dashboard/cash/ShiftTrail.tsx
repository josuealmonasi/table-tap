"use client";

import { useLocale, useT } from "@/lib/i18n/context";
import { dateLocale } from "@/lib/format";
import { useLogWords } from "@/hooks/useLogWords";
import type { TrailLine } from "@/lib/cash-shift";

interface ShiftTrailProps {
  trail: TrailLine[];
  currency: string;
  timeZone: string;
}

/**
 * What happened to the money during a shift — withdrawals, refunds,
 * discounts, cancellations, write-offs — each with who and when, worded the
 * way the activity log words it, so a handover can be read rather than
 * reconstructed.
 */
export default function ShiftTrail({ trail, currency, timeZone }: ShiftTrailProps) {
  const t = useT();
  const { locale } = useLocale();
  const { describe, specifics } = useLogWords(currency);
  if (trail.length === 0) return <p className="tt-muted tt-cashbox-note">{t("shift.trailEmpty")}</p>;
  return (
    <ul className="tt-cashbox-list">
      {trail.map((line, i) => (
        <li key={`${line.created_at}-${i}`} className="tt-cashbox-item">
          <span className="tt-cashbox-what">
            <span>
              {new Date(line.created_at).toLocaleTimeString(dateLocale(locale), { timeZone, hour: "2-digit", minute: "2-digit" })}
              {" · "}
              {line.actor_email ?? "—"} {describe(line)}
            </span>
            <span className="tt-muted">{specifics(line)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
