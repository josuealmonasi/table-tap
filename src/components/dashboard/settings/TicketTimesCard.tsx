"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import type { SettingsInput } from "@/hooks/useSettings";
import { clampTicketTimes } from "@/lib/ticket-wait";

/**
 * How long the kitchen should take before a ticket on the board turns amber,
 * then red. The owner's and the manager's: whoever runs the floor knows what
 * a busy night looks like. Both numbers are saved together, when a field is
 * left, so "late" can never end up before "warn".
 *
 * The fields stay enabled while a save is in flight. Disabling them threw the
 * cursor out of "late" the moment you tabbed in from "warn", because leaving
 * "warn" is what starts the save (`pnpm dialogs` caught it).
 */
export default function TicketTimesCard({
  warn,
  late,
  save,
}: {
  warn: number;
  late: number;
  save: (input: Partial<SettingsInput>) => Promise<boolean>;
}) {
  const t = useT();
  const [warnText, setWarnText] = useState(String(warn));
  const [lateText, setLateText] = useState(String(late));

  async function commit(): Promise<void> {
    const next = clampTicketTimes(warnText, lateText);
    setWarnText(String(next.warn));
    setLateText(String(next.late));
    if (next.warn === warn && next.late === late) return;
    if (!(await save({ ticket_warn_minutes: next.warn, ticket_late_minutes: next.late }))) {
      setWarnText(String(warn));
      setLateText(String(late));
    }
  }

  const field = (label: string, value: string, set: (v: string) => void) => (
    <label className="tt-field" style={{ maxWidth: 200 }}>
      <span className="tt-mod-label">{label}</span>
      <input
        className="tt-input"
        type="number"
        min={1}
        max={240}
        inputMode="numeric"
        value={value}
        onChange={e => set(e.target.value)}
        onBlur={() => void commit()}
      />
    </label>
  );

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>{t("ticketTimes.title")}</h3>
      </div>
      <p className="tt-muted" style={{ fontSize: 12, marginTop: 0 }}>{t("ticketTimes.hint")}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {field(t("ticketTimes.warn"), warnText, setWarnText)}
        {field(t("ticketTimes.late"), lateText, setLateText)}
      </div>
    </div>
  );
}
