"use client";

import { useT } from "@/lib/i18n/context";

/** How the waiter is dividing this collection up. */
export type Mode = "full" | "split" | "amount";

interface CollectionAmountProps {
  mode: Mode;
  /** Equal parts, already worked out; empty until the waiter asks for them. */
  plan: number[];
  /** How many of those parts are collected. */
  done: number;
  typed: string;
  onMode: (mode: Mode) => void;
  onDivide: (people: number) => void;
  onTyped: (value: string) => void;
}

/** How many ways a table gets divided, before somebody types a number instead. */
const WAYS = [2, 3, 4, 5, 6];

/**
 * How much this person is paying: all of it, an equal part, or a figure.
 *
 * The three answers a waiter gets at a table, as three chips and whatever the
 * chosen one needs. The amounts themselves are worked out by the calculator —
 * this only asks the question.
 */
export default function CollectionAmount({
  mode,
  plan,
  done,
  typed,
  onMode,
  onDivide,
  onTyped,
}: CollectionAmountProps) {
  const t = useT();

  return (
    <>
      <div className="tt-calc-modes" role="group" aria-label={t("settle.parts")}>
        {(["full", "split", "amount"] as const).map(m => (
          <button
            key={m}
            type="button"
            className={`tt-tip-chip ${mode === m ? "tt-tip-chip-active" : ""}`}
            aria-pressed={mode === m}
            onClick={() => (m === "split" ? onDivide(plan.length || 2) : onMode(m))}
          >
            {t(`settle.mode${m[0].toUpperCase()}${m.slice(1)}`)}
          </button>
        ))}
      </div>

      {mode === "split" && (
        <div style={{ marginBottom: 16 }}>
          <div className="tt-mod-label">{t("split.people")}</div>
          <div className="tt-tip-row">
            {WAYS.map(n => (
              <button
                key={n}
                type="button"
                className={`tt-tip-chip ${plan.length === n ? "tt-tip-chip-active" : ""}`}
                onClick={() => onDivide(n)}
              >
                {n}
              </button>
            ))}
          </div>
          {/* Which part is being collected right now, because the waiter is
              going round a table and has to know who is left. */}
          <p className="tt-muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
            {t("settle.shareOf", { n: Math.min(done + 1, plan.length), of: plan.length })}
          </p>
        </div>
      )}

      {mode === "amount" && (
        <div style={{ marginBottom: 16 }}>
          <label className="tt-mod-label" htmlFor="tt-calc-amount">
            {t("settle.howMuch")}
          </label>
          <input
            id="tt-calc-amount"
            className="tt-input"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.5"
            placeholder="0.00"
            value={typed}
            onChange={e => onTyped(e.target.value)}
          />
        </div>
      )}
    </>
  );
}
