"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { ExpandIcon } from "@/components/ui/icons";
import { groupsFor, type IconGroup, type IconVariant } from "@/lib/icon-groups";
import { useStoredIconGroups } from "./IconGroupsContext";

// Two groups can share a name — theirs and ours. The id decides.
const keyOf = (g: IconGroup) => g.id ?? g.name;

/** Which group contains the currently chosen emoji (so we can open it by default). */
function findGroupWith(groups: IconGroup[], value: string) {
  if (!value) return null;
  const found = groups.find(g => g.items.some(i => i.emoji === value));
  return found ? keyOf(found) : null;
}

/**
 * Icon picker, single-open accordion. value is the chosen emoji ("" = none).
 * variant picks the icon set: "product" (meals/drinks) or "addon" (condiments/
 * beverage add-ons). The restaurant's own groups come first, then ours.
 */
export default function IconPicker({
  value,
  onChange,
  label,
  variant = "product",
}: {
  value: string;
  onChange: (emoji: string) => void;
  label?: string;
  variant?: IconVariant;
}) {
  const t = useT();
  const groups = groupsFor(variant, useStoredIconGroups());
  const [openGroup, setOpenGroup] = useState<string | null>(() =>
    findGroupWith(groups, value),
  );

  return (
    <div>
      <div className="tt-mod-label">{label ?? t("menu.iconOptional")}</div>

      <div className="tt-accordion">
        {groups.map(g => {
          const key = keyOf(g);
          const isOpen = openGroup === key;
          const selected = g.items.find(i => i.emoji === value);
          return (
            <div key={key} className="tt-acc-item">
              <button
                type="button"
                className="tt-acc-head"
                aria-expanded={isOpen}
                onClick={() => setOpenGroup(isOpen ? null : key)}
              >
                {/* Los de fábrica se traducen; el nombre que puso el restaurante
                    se respeta tal cual lo escribió. */}
                <span>{g.labelKey ? t(g.labelKey) : g.name}</span>
                <span className="tt-acc-right">
                  {selected && <span style={{ fontSize: 15 }}>{selected.emoji}</span>}
                  <span className="tt-acc-chevron">
                    <ExpandIcon
                      size={13}
                      weight="bold"
                      style={{ transform: isOpen ? undefined : "rotate(-90deg)" }}
                    />
                  </span>
                </span>
              </button>
              {isOpen && (
                <div className="tt-chips tt-acc-body">
                  {g.items.map(o => (
                    <button
                      type="button"
                      key={o.emoji}
                      className={`tt-chip ${value === o.emoji ? "tt-chip-on" : ""}`}
                      // Toggle: click to select, click the selected one again to clear.
                      onClick={() => onChange(value === o.emoji ? "" : o.emoji)}
                    >
                      {o.emoji} {o.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
