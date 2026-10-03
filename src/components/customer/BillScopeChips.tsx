"use client";

import { useT } from "@/lib/i18n/context";

interface BillScopeChipsProps {
  scope: "all" | "mine";
  onChange: (next: "all" | "mine") => void;
}

/** Paying for the whole table, or only for what this phone ordered. */
export default function BillScopeChips({ scope, onChange }: BillScopeChipsProps) {
  const t = useT();
  return (
    <div className="tt-tip-row tt-bill-scope">
      <button
        type="button"
        className={`tt-tip-chip ${scope === "all" ? "tt-tip-chip-active" : ""}`}
        onClick={() => onChange("all")}
      >
        {t("bill.scopeAll")}
      </button>
      <button
        type="button"
        className={`tt-tip-chip ${scope === "mine" ? "tt-tip-chip-active" : ""}`}
        onClick={() => onChange("mine")}
      >
        {t("bill.scopeMine")}
      </button>
    </div>
  );
}
