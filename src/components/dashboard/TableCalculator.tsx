"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import TipPicker from "@/components/customer/TipPicker";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/format";
import { tipFor } from "@/lib/pricing";
import { suggestEqual } from "@/lib/table-balance";
import { newRef } from "@/lib/collection-ref";
import CollectionAmount, { type Mode } from "./CollectionAmount";
import type { Outstanding } from "@/lib/table-outstanding";

/**
 * The arithmetic half of an outstanding bill.
 *
 * The rows stay on the server, and so do the sitting ids: which sittings a
 * table owes on is how the money is attributed, not something a screen has any
 * use for.
 */
type Balance = Omit<Outstanding, "orders" | "sittings">;

interface TableCalculatorProps {
  open: boolean;
  onClose: () => void;
  tableId: string;
  tableLabel: string;
  currency: string;
  /** Refreshes the board behind, after every collection. */
  onCollected: () => void;
  /** Opens the promotion dialog on this same bill, where the screen has one. */
  onDiscount?: () => void;
}

/**
 * The waiter's calculator: a bill collected a bit at a time.
 *
 * Somebody pays MX$100, somebody else MX$50, and after each one the only
 * question is how much is left. The running balance comes back from the server
 * after every collection rather than being kept here — a screen doing its own
 * subtraction is a screen that can disagree with the till.
 *
 * Equal parts use the app's one way of dividing a bill, odd centavo on the
 * first share, so a table splitting four ways gets the same numbers whoever
 * works them out.
 */
export default function TableCalculator({
  open,
  onClose,
  tableId,
  tableLabel,
  currency,
  onCollected,
  onDiscount,
}: TableCalculatorProps) {
  const t = useT();
  const toast = useToast();
  const [bill, setBill] = useState<Balance | null>(null);
  const [mode, setMode] = useState<Mode>("full");
  const [plan, setPlan] = useState<number[]>([]);
  const [done, setDone] = useState(0);
  const [typed, setTyped] = useState("");
  const [tipPct, setTipPct] = useState(0);
  const [tipCustom, setTipCustom] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // One reference per collection, kept across a retry and replaced once it
  // lands: the same tap must never be recorded twice.
  const [ref, setRef] = useState(newRef);
  /** The balance could not be read, so there is no number to collect against. */
  const [lost, setLost] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/table-bill?tableId=${tableId}`);
      const data = res.ok ? await res.json() : null;
      setBill(data?.outstanding ?? null);
      setLost(!data?.outstanding);
    } catch {
      // Offline. Said plainly rather than left spinning: a waiter waiting on a
      // number that is never coming will collect from memory instead.
      setLost(true);
    }
  }, [tableId]);

  useEffect(() => {
    if (!open) return;
    setBill(null);
    setLost(false);
    setMode("full");
    setPlan([]);
    setDone(0);
    setTyped("");
    void load();
  }, [open, load]);

  const owed = bill?.owed ?? 0;
  // Never more than is owed: the server caps it too, but a button that offers
  // to take MX$1,000 on a MX$100 bill has already misled the person holding it.
  const asked =
    mode === "full" ? owed : mode === "split" ? (plan[done] ?? 0) : Number(typed) || 0;
  const amount = Math.min(Math.max(0, asked), owed);
  const tip = tipCustom ?? tipFor(amount, tipPct);

  function divide(people: number): void {
    setMode("split");
    setPlan(suggestEqual(owed, people));
    setDone(0);
  }

  async function collect(method: "cash" | "card"): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch("/api/table-payment/part", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId, amount, tip, method, ref }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error ?? t("settle.failed"), "error");
        return;
      }

      onCollected();
      setRef(newRef());
      setTipPct(0);
      setTipCustom(null);
      setTyped("");

      if (data.settled) {
        toast(t("settle.done"));
        onClose();
        return;
      }

      setBill({
        ordered: data.ordered,
        collected: data.collected,
        tips: data.tips,
        owed: data.owed,
      });
      setDone(n => n + 1);
      toast(
        t("settle.collectedOk", {
          amount: formatMoney(amount + tip, currency),
          left: formatMoney(data.owed ?? 0, currency),
        }),
      );
    } catch {
      // Money, so it never queues: a collection replayed on reconnect is a
      // table charged twice. Refuse it and say why.
      toast(t("offline.blocked"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth={460} label={t("settle.parts")}>
      <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 12 }}>
        {t("settle.partsTitle", { label: tableLabel })}
      </h3>

      {lost ? (
        <p className="tt-muted">{t("settle.failed")}</p>
      ) : !bill ? (
        <p className="tt-muted">{t("common.loading")}</p>
      ) : owed <= 0 ? (
        <p className="tt-muted">{t("settle.nothing")}</p>
      ) : (
        <>
          <div className="tt-calc-figures">
            <div className="tt-row">
              <span className="tt-muted">{t("settle.total")}</span>
              <span>{formatMoney(bill.ordered, currency)}</span>
            </div>
            {bill.collected > 0 && (
              <div className="tt-row">
                <span className="tt-muted">{t("settle.collected")}</span>
                <span className="tt-save">−{formatMoney(bill.collected, currency)}</span>
              </div>
            )}
            <div className="tt-bill-total tt-row">
              <strong>{t("settle.owed")}</strong>
              <strong style={{ fontSize: 18 }}>{formatMoney(owed, currency)}</strong>
            </div>
          </div>

          <CollectionAmount
            mode={mode}
            plan={plan}
            done={done}
            typed={typed}
            onMode={setMode}
            onDivide={divide}
            onTyped={setTyped}
          />

          <TipPicker
            currency={currency}
            tipPct={tipPct}
            tipCustom={tipCustom}
            maxTip={amount}
            onPresetTip={pct => {
              setTipPct(pct);
              setTipCustom(null);
            }}
            onCustomTip={setTipCustom}
          />

          <div className="tt-bill-actions">
            <button
              className="tt-btn tt-btn-primary tt-btn-lg"
              style={{ width: "100%" }}
              disabled={busy || amount <= 0}
              onClick={() => collect("cash")}
            >
              {t("settle.cash")} · {formatMoney(amount + tip, currency)}
            </button>
            <button
              className="tt-btn tt-btn-ghost tt-btn-lg"
              style={{ width: "100%", marginTop: 8 }}
              disabled={busy || amount <= 0}
              onClick={() => collect("card")}
            >
              {t("settle.card")} · {formatMoney(amount + tip, currency)}
            </button>
            {/* A promotion still goes through whoever may grant one — the
                waiter asks from here rather than leaving the table to do it. */}
            {onDiscount && (
              <button
                className="tt-btn tt-btn-ghost tt-btn-sm"
                style={{ width: "100%", marginTop: 12 }}
                disabled={busy}
                onClick={onDiscount}
              >
                {t("settle.promo")}
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
