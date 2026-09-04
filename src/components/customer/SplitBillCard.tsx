"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import type { SplitState } from "@/hooks/useSplit";

interface SplitBillCardProps {
  split: SplitState | null;
  diner: string;
  busy: boolean;
  currency: string;
  /** What the table owes right now — what a new proposal would divide. */
  outstanding: number;
  propose: (shares: number) => Promise<void>;
  join: () => Promise<void>;
  cancel: () => Promise<void>;
  onPay: () => void;
}

/**
 * Dividing the bill evenly, from the diner's phone.
 *
 * Four states, because a table goes through them out loud: nobody has asked
 * yet; somebody has asked and we are waiting; everyone agreed and this is what
 * you owe; you have paid.
 *
 * The one thing this screen must never do is get in the way of ordering. A
 * table that has agreed to split can still want another round, and the answer
 * to that is "yes, and it is yours" — never "no, the bill is closed".
 */
export default function SplitBillCard({
  split,
  diner,
  busy,
  currency,
  outstanding,
  propose,
  join,
  cancel,
  onPay,
}: SplitBillCardProps) {
  const t = useT();
  const [people, setPeople] = useState(2);

  // Nothing owed is not a bill to divide.
  if (outstanding <= 0 && !split) return null;

  // ── Nobody has asked yet
  if (!split) {
    return (
      <div className="tt-split">
        <strong>{t("split.title")}</strong>
        <span className="tt-muted tt-split-hint">{t("split.hint")}</span>
        <div className="tt-split-row">
          <label className="tt-split-people">
            <span className="tt-mod-label">{t("split.people")}</span>
            <select
              className="tt-input"
              value={people}
              onChange={e => setPeople(Number(e.target.value))}
            >
              {Array.from({ length: 19 }, (_, i) => i + 2).map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="tt-btn tt-btn-primary"
            disabled={busy}
            onClick={() => propose(people)}
          >
            {t("split.propose", { each: formatMoney(outstanding / people, currency) })}
          </button>
        </div>
      </div>
    );
  }

  const mine = split.mine;

  // ── Agreed, and this is the bill
  if (split.status === "locked" && mine) {
    const total = mine.amount + split.ownSince;
    return (
      <div className="tt-split tt-split-locked">
        <strong>{t("split.yourShare")}</strong>
        <span className="tt-split-amount">{formatMoney(mine.amount, currency)}</span>
        {split.ownSince > 0 && (
          // Ordered after the table agreed, so it is this person's alone. Said
          // plainly rather than folded silently into one number: somebody who
          // orders a beer and then sees a bigger figure deserves to know why.
          <span className="tt-muted tt-split-since">
            {t("split.plusYours", { amount: formatMoney(split.ownSince, currency) })}
            {" · "}
            <strong>{formatMoney(total, currency)}</strong>
          </span>
        )}
        {mine.paid ? (
          <span className="tt-split-done">{t("split.paid")}</span>
        ) : (
          <button type="button" className="tt-btn tt-btn-primary" onClick={onPay} disabled={busy}>
            {t("split.payShare", { amount: formatMoney(total, currency) })}
          </button>
        )}
      </div>
    );
  }

  // ── Somebody asked; we are waiting on the rest
  const iAsked = split.proposedBy === diner;
  return (
    <div className="tt-split">
      <strong>{t("split.asked", { n: split.shares })}</strong>
      <span className="tt-muted tt-split-hint">
        {t("split.waiting", { joined: split.joined, of: split.shares })}
      </span>
      <div className="tt-split-row">
        {mine ? (
          <button type="button" className="tt-btn tt-btn-ghost" disabled={busy} onClick={cancel}>
            {iAsked ? t("split.callOff") : t("split.leave")}
          </button>
        ) : (
          <>
            <button type="button" className="tt-btn tt-btn-primary" disabled={busy} onClick={join}>
              {t("split.join")}
            </button>
            <button type="button" className="tt-btn tt-btn-ghost" disabled={busy} onClick={cancel}>
              {t("split.no")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
