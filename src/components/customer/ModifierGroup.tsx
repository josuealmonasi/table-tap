import type { Modifier } from "@/lib/types";

/** One modifier group (e.g. "Spice level") rendered as a row of selectable chips. */
export default function ModifierGroup({
  modifier,
  value,
  onToggle,
}: {
  modifier: Modifier;
  value: string | string[] | undefined;
  onToggle: (option: string) => void;
}) {
  const isSelected = (option: string) =>
    modifier.type === "single"
      ? value === option
      : ((value as string[]) ?? []).includes(option);

  return (
    <div style={{ marginBottom: 20 }}>
      <div className="tt-mod-label">
        {modifier.label}
        {modifier.type === "multi" && <span className="tt-muted"> (choose any)</span>}
      </div>
      <div className="tt-chips">
        {modifier.options.map(opt => (
          <button
            key={opt}
            className={`tt-chip ${isSelected(opt) ? "tt-chip-on" : ""}`}
            onClick={() => onToggle(opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
