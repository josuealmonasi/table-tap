"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { DeleteIcon } from "@/components/ui/icons";
import { useT } from "@/lib/i18n/context";
import {
  cleanSchedule,
  scheduleError,
  type MenuSchedule,
  type ScheduleRule,
  type Weekday,
} from "@/lib/menu-schedule";

const ALL_DAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

const EMPTY_RULE: ScheduleRule = {
  days: [1, 2, 3, 4, 5],
  allDay: false,
  start: "12:00",
  end: "17:00",
};

interface ScheduleDialogProps {
  open: boolean;
  menuName: string;
  schedule?: MenuSchedule | null;
  onClose: () => void;
  onSave: (schedule: MenuSchedule | null) => Promise<void>;
}

/**
 * Opening hours for one menu.
 *
 * A menu can need more than one window — lunch on weekdays and all day at the
 * weekend — so the editor is a list of rules rather than a single range. The
 * schedule can be paused without losing it, or removed entirely to put the
 * menu back on its switch alone.
 */
export default function ScheduleDialog({
  open,
  menuName,
  schedule,
  onClose,
  onSave,
}: ScheduleDialogProps) {
  const t = useT();
  const [enabled, setEnabled] = useState(schedule?.enabled ?? true);
  const [rules, setRules] = useState<ScheduleRule[]>(
    schedule?.rules?.length ? schedule.rules : [EMPTY_RULE],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Measured against the schedule the dialog was handed rather than a snapshot
  // of its own first render, so saving settles the button instead of leaving it
  // lit over changes that are already stored.
  const stored = JSON.stringify([
    schedule?.enabled ?? true,
    schedule?.rules?.length ? schedule.rules : [EMPTY_RULE],
  ]);
  const dirty = stored !== JSON.stringify([enabled, rules]);

  const dayNames = [0, 1, 2, 3, 4, 5, 6].map(d => t(`sched.day${d}`));

  function patch(index: number, next: Partial<ScheduleRule>) {
    setRules(rs => rs.map((r, i) => (i === index ? { ...r, ...next } : r)));
    setError(null);
  }

  function toggleDay(index: number, day: Weekday) {
    const rule = rules[index];
    patch(index, {
      days: rule.days.includes(day)
        ? rule.days.filter(d => d !== day)
        : [...rule.days, day],
    });
  }

  async function save() {
    const candidate = cleanSchedule({ enabled, rules });
    const bad = scheduleError({ enabled, rules });
    if (bad) return setError(t(bad));
    setSaving(true);
    await onSave(candidate);
    setSaving(false);
    onClose();
  }

  /** Clears the hours entirely — the menu goes back to its switch alone. */
  async function remove() {
    setSaving(true);
    await onSave(null);
    setSaving(false);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth={640}
      title={t("sched.title", { name: menuName })}
    >
      <p className="tt-muted" style={{ marginTop: 0, fontSize: 13 }}>
        {t("sched.hint")}
      </p>

      <label className="tt-settings-toggle">
        <span>
          <strong>{t("sched.enabled")}</strong>
          <span className="tt-muted" style={{ display: "block", fontSize: 12 }}>
            {t("sched.enabledHint")}
          </span>
        </span>
        <span className="tt-switch" title={t(enabled ? "sched.on" : "sched.paused")}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
          />
          <span className="tt-switch-track" />
        </span>
      </label>

      <div className="tt-sched-rules">
        {rules.map((rule, i) => (
          <div key={i} className="tt-sched-rule">
            <div className="tt-sched-days">
              {ALL_DAYS.map(d => (
                <button
                  key={d}
                  type="button"
                  className={`tt-sched-day ${rule.days.includes(d) ? "tt-sched-day-on" : ""}`}
                  aria-pressed={rule.days.includes(d)}
                  onClick={() => toggleDay(i, d)}
                >
                  {dayNames[d]}
                </button>
              ))}
            </div>

            <div className="tt-sched-when">
              <label className="tt-check">
                <input
                  type="checkbox"
                  checked={rule.allDay}
                  onChange={e => patch(i, { allDay: e.target.checked })}
                />
                {t("sched.allDay")}
              </label>

              {!rule.allDay && (
                <span className="tt-sched-times">
                  <input
                    className="tt-input"
                    type="time"
                    value={rule.start ?? ""}
                    aria-label={t("sched.from")}
                    onChange={e => patch(i, { start: e.target.value })}
                  />
                  <span aria-hidden="true">→</span>
                  <input
                    className="tt-input"
                    type="time"
                    value={rule.end ?? ""}
                    aria-label={t("sched.to")}
                    onChange={e => patch(i, { end: e.target.value })}
                  />
                </span>
              )}

              {rules.length > 1 && (
                <button
                  type="button"
                  className="tt-iconbtn"
                  title={t("sched.removeRule")}
                  onClick={() => setRules(rs => rs.filter((_, x) => x !== i))}
                >
                  <DeleteIcon size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="tt-btn tt-btn-ghost tt-btn-sm"
        onClick={() => setRules(rs => [...rs, EMPTY_RULE])}
      >
        {t("sched.addRule")}
      </button>

      {error && <p className="tt-field-error">{error}</p>}

      <div className="tt-prodform-actions">
        <button
          type="button"
          className="tt-btn tt-btn-primary tt-btn-sm"
          disabled={saving || !dirty}
          onClick={save}
        >
          {saving ? t("common.saving") : t("promos.saveChanges")}
        </button>
        {schedule && (
          <button
            type="button"
            className="tt-btn tt-btn-ghost tt-btn-sm tt-danger-text"
            disabled={saving}
            onClick={remove}
          >
            {t("sched.remove")}
          </button>
        )}
        <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={onClose}>
          {t("menu.cancel")}
        </button>
      </div>
    </Modal>
  );
}
