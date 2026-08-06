import type { Modifier } from "@/lib/types";
import { useT } from "@/lib/i18n/context";

/** One modifier group (e.g. "Spice level") rendered as a row of selectable chips. */
export default function ModifierGroup({
  modifier,
  value,
  onToggle,
  /** Required and still unanswered — the reason Add to cart is disabled. */
  missing = false,
}: {
  modifier: Modifier;
  value: string | string[] | undefined;
  onToggle: (option: string) => void;
  missing?: boolean;
}) {
  const t = useT();
  const isSelected = (option: string) =>
    modifier.type === "single"
      ? value === option
      : ((value as string[]) ?? []).includes(option);

  return (
    <div style={{ marginBottom: 20 }}>
      <div className="tt-mod-label">
        {modifier.label}
        {/* The label says required up front; the red state only appears once
            they try to add, so nothing is scolding them before they've had a
            chance to choose. */}
        {modifier.required ? (
          <span className={missing ? "tt-req tt-req-missing" : "tt-req"}>
            {t("item.required")}
          </span>
        ) : (
          modifier.type === "multi" && (
            <span className="tt-muted"> {t("item.chooseAny")}</span>
          )
        )}
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
