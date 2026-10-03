"use client";

import type { CSSProperties } from "react";

interface SettingsToggleProps {
  title: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** What the switch says it is set to, read aloud and on hover; the title when absent. */
  stateLabel?: string;
  style?: CSSProperties;
}

/** One setting that is on or off: what it is, why it matters, and the switch. */
export default function SettingsToggle({
  title,
  hint,
  checked,
  onChange,
  disabled = false,
  stateLabel,
  style,
}: SettingsToggleProps) {
  return (
    <label className="tt-settings-toggle" style={style}>
      <span>
        <strong>{title}</strong>
        <span className="tt-muted" style={{ display: "block", fontSize: 12 }}>
          {hint}
        </span>
      </span>
      <span className="tt-switch" title={stateLabel}>
        <input
          type="checkbox"
          aria-label={stateLabel ?? title}
          checked={checked}
          disabled={disabled}
          onChange={e => onChange(e.target.checked)}
        />
        <span className="tt-switch-track" />
      </span>
    </label>
  );
}
