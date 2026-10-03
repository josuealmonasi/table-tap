"use client";

import { formatMoney } from "@/lib/format";
import { tagLabel } from "@/lib/dietary";
import { useDietaryTags } from "@/components/DietaryTagsContext";
import { useLocale, useT } from "@/lib/i18n/context";
import type { MenuItem } from "@/lib/types";

interface ProductChipsProps {
  dietary: string[];
  onToggleDietary: (key: string) => void;
  addons: MenuItem[];
  picked: string[];
  onToggleAddon: (id: string) => void;
  currency: string;
}

/** The dish's dietary and allergen tags, and the extras it offers, picked as chips. */
export default function ProductChips({
  dietary,
  onToggleDietary,
  addons,
  picked,
  onToggleAddon,
  currency,
}: ProductChipsProps) {
  const t = useT();
  const { locale: lang } = useLocale();
  const dietaryOptions = useDietaryTags();
  return (
    <>
      <div>
        <div className="tt-mod-label" style={{ marginTop: 6 }}>
          {t("menu.dietaryAllergens")}{" "}
          <span className="tt-muted" style={{ fontWeight: 400 }}>
            {t("menu.shownToCustomers")}
          </span>
        </div>
        <div className="tt-chips">
          {dietaryOptions.map(tag => (
            <button
              type="button"
              key={tag.key}
              className={`tt-chip ${dietary.includes(tag.key) ? "tt-chip-on" : ""}`}
              onClick={() => onToggleDietary(tag.key)}
            >
              {tag.emoji} {tagLabel(tag, t, lang)}
            </button>
          ))}
        </div>
      </div>

      {addons.length > 0 && (
        <div>
          <div className="tt-mod-label" style={{ marginTop: 6 }}>
            {t("menu.extrasOffered")}
          </div>
          <div className="tt-chips">
            {addons.map(a => (
              <button
                type="button"
                key={a.id}
                className={`tt-chip ${picked.includes(a.id) ? "tt-chip-on" : ""}`}
                onClick={() => onToggleAddon(a.id)}
              >
                {a.emoji ? `${a.emoji} ` : ""}
                {a.name} · {formatMoney(a.price, currency)}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
