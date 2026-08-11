"use client";

import { useT } from "@/lib/i18n/context";
import { NOTE_MAX } from "@/lib/notes";

interface NoteFieldProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}

/**
 * A kitchen note with a hard cap and a live count.
 *
 * Unbounded, one diner's paragraph pushed everything below it off the screen
 * and would print a ticket nobody reads. The counter appears as you approach
 * the limit rather than sitting there from the first keystroke — a bare field
 * is quieter, and the number only matters when it's close.
 */
export default function NoteField({
  label,
  placeholder,
  value,
  onChange,
}: NoteFieldProps) {
  const t = useT();
  const near = value.length >= NOTE_MAX * 0.6;
  return (
    <div>
      <div className="tt-note-head">
        <span className="tt-mod-label">{label}</span>
        {near && (
          <span
            className={`tt-note-count ${value.length >= NOTE_MAX ? "tt-note-full" : ""}`}
            aria-live="polite"
          >
            {value.length}/{NOTE_MAX}
          </span>
        )}
      </div>
      <textarea
        className="tt-input"
        rows={2}
        maxLength={NOTE_MAX}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value.slice(0, NOTE_MAX))}
        aria-label={label}
      />
      <span className="tt-sr-only">{t("item.noteLimit", { max: NOTE_MAX })}</span>
    </div>
  );
}
