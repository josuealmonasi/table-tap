"use client";

import { useId, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import type { SplitState } from "@/hooks/useSplit";
import { shareChoices } from "@/lib/split-shares";

interface SplitBillCardProps {
  split: SplitState | null;
  diner: string;
  busy: boolean;
  currency: string;
  /** What the table owes right now — what a new proposal would divide. */
  outstanding: number;
  /**
   * How many devices have ordered on this table.
   *
   * The ceiling on a proposal, and the reason there may be no proposal at all.
   * One diner alone was offered a split between 2 and 20, chose twelve, and
   * then sat in front of a frozen bill waiting for eleven people who did not
   * exist — with no way to pay until it was called off. Nineteen people at the
   * table of whom ten ordered is a bill that divides ten ways, not nineteen.
   */
  party: number;
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
 * The first of those is a question, not a form. It used to open as a heading,
 * a hint and a dropdown sitting above everything else on the bill, so the
 * first thing anybody saw when they went to pay was a decision they had not
 * asked to make. It is one line now, and unfolds when somebody says yes.
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
  party,
  propose,
  join,
  cancel,
  onPay,
}: SplitBillCardProps) {
  const t = useT();
  const [people, setPeople] = useState(2);
  const [asking, setAsking] = useState(false);
  const countId = useId();

  // Nothing owed is not a bill to divide.
  if (outstanding <= 0 && !split) return null;

  // ── Nobody has asked yet
  if (!split) {
    // Never more ways than there are people eating. A share belongs to the
    // device that ordered, so a thirteenth share at a table of one is a share
    // nobody can ever take — and until it is claimed or the whole proposal is
    // called off, the bill cannot be paid by anybody.
    const choices = shareChoices(party);

    // Nobody to divide it with. Not a card explaining itself, not a disabled
    // control — nothing: the offer is simply not made, which is the honest
    // shape of "this is not available" and leaves the bill uncluttered for the
    // person who came here to pay it.
    if (choices.length === 0) return null;

    if (!asking) {
      return (
        <div className="tt-split-ask">
          <button type="button" className="tt-linkbtn" onClick={() => setAsking(true)}>
            {t("split.ask")}
          </button>
        </div>
      );
    }

    const shares = Math.min(people, choices[choices.length - 1]);
    return (
      <div className="tt-split">
        <strong>{t("split.title")}</strong>
        <span className="tt-muted tt-split-hint">{t("split.hint")}</span>
        {/* The question above, the answer and the button on one row beneath
            it. Inside the label they competed for the same 375px: wide enough
            for "¿Cuántos son?" left the button too narrow and it lost the end
            of its own amount off the edge of the card. */}
        <label className="tt-mod-label" htmlFor={countId}>
          {t("split.people")}
        </label>
        <div className="tt-split-row">
          <select
            id={countId}
            className="tt-input tt-split-count"
            value={shares}
            onChange={e => setPeople(Number(e.target.value))}
          >
            {choices.map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <button
            type="button"
            className="tt-btn tt-btn-primary"
            disabled={busy}
            onClick={() => propose(shares)}
          >
            {t("split.propose", { each: formatMoney(outstanding / shares, currency) })}
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

  // ── Frozen, and this phone is not in it
  //
  // Reachable whenever fewer shares were agreed than there are people who
  // ordered: three ordered, two of them halved it. The card used to fall
  // through to "somebody asked — join?", offering a seat at a table that is
  // full and frozen, and the bill screen behind it still offered to pay the
  // whole thing. Their food is inside the frozen shares; there is nothing here
  // for them to do.
  if (split.status === "locked") {
    return (
      <div className="tt-split">
        <strong>{t("split.title")}</strong>
        <span className="tt-muted tt-split-hint">
          {t("split.othersPaying", { n: split.shares })}
        </span>
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
