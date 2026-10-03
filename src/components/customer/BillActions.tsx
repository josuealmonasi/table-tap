"use client";

import { useT } from "@/lib/i18n/context";

interface BillActionsProps {
  /** A waiter has been called and is on the way. */
  called: boolean;
  busy: boolean;
  /**
   * Calling somebody over is the only thing left: no cards here, a waiter
   * opened the bill, or the table pays through a frozen split.
   */
  alone: boolean;
  /** Why there is no card button, when there is none. */
  reasonKey: string | null;
  onPayOnline: () => void;
  onPayAtTable: () => void;
}

/**
 * The buttons at the foot of the bill: pay online, or have somebody come.
 *
 * Calling somebody over always works, so that button is ALWAYS here. Gated
 * behind the split it left a phone with no share looking at a bill and no way
 * to do anything about it, not even ask for help.
 */
export default function BillActions({
  called,
  busy,
  alone,
  reasonKey,
  onPayOnline,
  onPayAtTable,
}: BillActionsProps) {
  const t = useT();
  if (called) {
    return (
      <div className="tt-bill-called" role="status">
        <strong>{t("bill.called")}</strong>
        <p className="tt-muted tt-subline" style={{ fontSize: 13, margin: 0 }}>
          {t("bill.calledBody")}
        </p>
      </div>
    );
  }
  return (
    <div className="tt-bill-actions">
      {/* A bill somebody else is collecting is settled with them. Said
          plainly, with the one button that does anything, rather than a card
          field that would be refused after they had typed their number in —
          and said at all, because a card button that is simply missing leaves
          them looking for it. Three reasons reach here and they send the diner
          to do different things: pay their share, wait for the waiter already
          coming, or call one. */}
      {alone ? (
        <p className="tt-muted tt-subline" style={{ fontSize: 13, marginTop: 0 }}>
          {reasonKey ? t(reasonKey) : null}
        </p>
      ) : (
        <button
          className="tt-btn tt-btn-primary tt-btn-lg"
          style={{ width: "100%" }}
          disabled={busy}
          onClick={onPayOnline}
        >
          {/* The pair of buttons is a choice between two ways to settle, so
              each one names its way: online, or with whoever is serving. The
              amount is on the total line directly above, and repeating it
              here made the buttons read as "pay" versus something else. */}
          {busy ? t("cart.redirecting") : t("bill.payNow")}
        </button>
      )}
      <button
        className={`tt-btn tt-btn-lg ${alone ? "tt-btn-primary" : "tt-btn-ghost"}`}
        style={{ width: "100%", marginTop: alone ? 0 : 8 }}
        disabled={busy}
        onClick={onPayAtTable}
      >
        {busy ? t("bill.calling") : t("bill.payAtTable")}
      </button>
    </div>
  );
}
