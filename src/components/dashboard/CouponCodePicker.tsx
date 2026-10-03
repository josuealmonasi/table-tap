"use client";

import { useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { Skeleton } from "@/components/ui/Skeleton";
import type { CouponOption } from "@/hooks/useCouponOptions";

interface CouponCodePickerProps {
  code: string;
  onCode: (code: string) => void;
  options: CouponOption[];
  loading: boolean;
  failed: boolean;
  currency: string;
}

/** The code field, with the codes that apply listed under it and picked by tap or by arrow keys. */
export default function CouponCodePicker({
  code,
  onCode,
  options,
  loading,
  failed,
  currency,
}: CouponCodePickerProps) {
  const t = useT();
  const [highlight, setHighlight] = useState(0);
  const shown = useMemo(() => {
    const q = code.trim().toLowerCase();
    return options.filter(o => !q || o.code.toLowerCase().includes(q));
  }, [options, code]);

  useEffect(() => setHighlight(0), [code]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (shown.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(h => {
        const next = e.key === "ArrowDown" ? h + 1 : h - 1;
        return (next + shown.length) % shown.length;
      });
    } else if (e.key === "Enter" && shown[highlight] && shown[highlight].code !== code) {
      // Enter picks the highlighted code first; a second Enter submits it.
      e.preventDefault();
      onCode(shown[highlight].code);
    }
  }

  return (
    <>
      <label className="tt-mod-label" htmlFor="tt-bill-code">
        {t("dash.billCodeLabel")}
      </label>
      <input
        id="tt-bill-code"
        className="tt-input"
        style={{ width: "100%", marginTop: 6 }}
        value={code}
        placeholder={t("dash.billCodePick")}
        role="combobox"
        aria-expanded={shown.length > 0}
        aria-controls="tt-bill-code-list"
        autoComplete="off"
        onChange={e => onCode(e.target.value.toUpperCase())}
        onKeyDown={onKeyDown}
        autoFocus
      />

      {/* In flow, not floating: the modal is a scroll container, and an
          absolutely positioned menu inside one gets clipped by it — the bug we
          hit the last time a dropdown lived in a dialog. A list that pushes
          the content simply scrolls with it. */}
      {loading && (
        <div className="tt-code-list" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="tt-code-option">
              <span className="tt-code-name">
                <Skeleton width={92} height={14} />
                <Skeleton width={130} height={11} />
              </span>
              <Skeleton width={62} height={14} />
            </div>
          ))}
        </div>
      )}

      {!loading && (
        <div className="tt-code-list" id="tt-bill-code-list" role="listbox">
          {shown.length === 0 && (
            <p
              className="tt-muted"
              style={{ margin: 0, padding: "14px 12px", fontSize: 13 }}
            >
              {t(failed ? "dash.billCodesFailed" : "dash.billCodeNone")}
            </p>
          )}
          {shown.map((option, i) => (
            <button
              key={option.code}
              type="button"
              role="option"
              aria-selected={option.code === code}
              className={`tt-code-option ${i === highlight ? "tt-code-option-on" : ""}`}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => onCode(option.code)}
            >
              <span className="tt-code-name">
                <strong>{option.code}</strong>
                <span className="tt-muted tt-subline" style={{ fontSize: 12 }}>
                  {option.kind === "percent"
                    ? t("dash.billCodePct", { pct: String(option.value) })
                    : t("dash.billCodeFixed", {
                        amount: formatMoney(option.value, currency),
                      })}
                  {option.remaining !== null
                    ? ` · ${t("dash.billCodeLeft", { n: String(option.remaining) })}`
                    : ""}
                </span>
              </span>
              <strong className="tt-accent" style={{ flex: "none" }}>
                −{formatMoney(option.amount, currency)}
              </strong>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
