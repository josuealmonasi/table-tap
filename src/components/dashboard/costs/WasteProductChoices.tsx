"use client";

import { useT } from "@/lib/i18n/context";
import type { Modifier } from "@/lib/types";
import type { Choices } from "@/lib/costs/recipe-cost";

interface WasteProductChoicesProps {
  modifiers: Modifier[];
  extras: { id: string; label: string }[];
  mods: Choices;
  extraIds: string[];
  disabled: boolean;
  onMods: (mods: Choices) => void;
  onExtras: (ids: string[]) => void;
}

/** Ask what was actually made; the first menu option is not a waste choice. */
export default function WasteProductChoices({ modifiers, extras, mods, extraIds, disabled, onMods, onExtras }: WasteProductChoicesProps) {
  const t = useT();
  const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(v => v !== value) : [...values, value];
  const pickedMany = (label: string): string[] => { const value = mods[label]; return Array.isArray(value) ? value : []; };
  return (
    <fieldset className="tt-field" disabled={disabled}>
      <legend className="tt-mod-label">{t("waste.choices")}</legend>
      {modifiers.map(group => group.type === "single" ? (
        <label className="tt-field" key={group.label}>
          <span className="tt-mod-label">{group.label}{group.required && ` · ${t("item.required")}`}</span>
          <select className="tt-input" name={group.label} required={group.required} value={typeof mods[group.label] === "string" ? mods[group.label] : ""}
            onChange={e => onMods(Object.fromEntries([...Object.entries(mods).filter(([key]) => key !== group.label), ...(e.target.value ? [[group.label, e.target.value]] : [])]))}>
            <option value="">{t("waste.choose")}</option>
            {group.options.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      ) : (
        <fieldset className="tt-field" key={group.label}>
          <legend className="tt-mod-label">{group.label}{group.required && ` · ${t("item.required")}`}</legend>
          {group.options.map(option => (
            <label key={option} className="tt-check">
              <input type="checkbox" checked={pickedMany(group.label).includes(option)}
                onChange={() => onMods({ ...mods, [group.label]: toggle(pickedMany(group.label), option) })} />
              {option}
            </label>
          ))}
        </fieldset>
      ))}
      {extras.length > 0 && <span className="tt-mod-label">{t("waste.extras")}</span>}
      {extras.map(extra => (
        <label className="tt-check" key={extra.id}>
          <input type="checkbox" value={extra.id} checked={extraIds.includes(extra.id)} onChange={() => onExtras(toggle(extraIds, extra.id))} />
          {extra.label}
        </label>
      ))}
    </fieldset>
  );
}
