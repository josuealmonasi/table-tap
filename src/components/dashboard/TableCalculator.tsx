"use client";

import { usePaymentCheck } from "@/hooks/usePaymentCheck";

import { useCallback, useEffect, useState } from "react";
import { useStaffSlotReceipts } from "@/hooks/useStaffSlotReceipts";
import SlotReceiptPrints from "./SlotReceiptPrints";
import TableSplitCollection from "./TableSplitCollection";
import SplitWriteOffDialog from "./SplitWriteOffDialog";
import type { StaffSlotSplit } from "@/lib/split-slots-staff";
import { SPLIT_POLL_MS } from "@/lib/poll";
import CashChange from "@/components/dashboard/CashChange";
import { Modal } from "@/components/ui/Modal";
import TipPicker from "@/components/customer/TipPicker";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/format";
import { tipFor } from "@/lib/pricing";
import { applyPayment, suggestEqual } from "@/lib/table-balance";
import { newRef } from "@/lib/collection-ref";
import CollectionAmount, { type Mode } from "./CollectionAmount";
import type { Order } from "@/lib/types";
import type { Outstanding } from "@/lib/table-outstanding";

/**
 * The arithmetic half of an outstanding bill.
 *
 * Order rows stay separate for the write-off quote. A divided bill also
 * carries its sitting id to the slot writer, which checks the table and
 * restaurant again: a choice on one table must never collect another table's food.
 */
type Balance = Omit<Outstanding, "orders" | "sittings">;

interface TableCalculatorProps {
  open: boolean;
  canApprove?: boolean;
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
  currency: menuCurrency,
  onCollected,
  onDiscount,
  canApprove = false,
}: TableCalculatorProps) {
  const t = useT();
  const toast = useToast();
  const [splits, setSplits] = useState<StaffSlotSplit[]>([]);
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
  const [chosenCurrency, setChosenCurrency] = useState<string | null>(null);
  const [writingOff, setWritingOff] = useState<StaffSlotSplit | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);

  const { receipts, rememberReceipt } = useStaffSlotReceipts(`${open}:${tableId}`);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/table-bill?tableId=${tableId}`);
      const data = res.ok ? await res.json() : null;
      setBill(data?.outstanding ?? null);
      setSplits(data?.splits ?? []);
      setOrders(data?.orders ?? []);
      setLost(!data?.outstanding);
      return Boolean(data?.outstanding);
    } catch {
      // Offline. Said plainly rather than left spinning: a waiter waiting on a
      // number that is never coming will collect from memory instead.
      setLost(true);
      return false;
    }
  }, [tableId]);

  useEffect(() => {
    if (!open) return;
    setWritingOff(null);
    setBill(null);
    setOrders([]);
    setLost(false);
    setMode("full");
    setPlan([]);
    setDone(0);
    setTyped("");
    void load();
    const timer = setInterval(() => void load(), SPLIT_POLL_MS);
    return () => clearInterval(timer);
  }, [open, load]);

  async function refreshBill(): Promise<void> {
    if (!await load()) throw new Error("Could not refresh the bill");
  }
  const paymentCheck = usePaymentCheck(refreshBill, `${open}:${tableId}`);

  const balance = bill?.balances?.find(b => b.currency === chosenCurrency && b.owed > 0) ?? bill?.balances?.find(b => b.owed > 0) ?? bill;
  const currency = balance?.currency ?? menuCurrency;
  const owed = balance?.owed ?? 0;
  // Never more than is owed: the server caps it too, but a button that offers
  // to take MX$1,000 on a MX$100 bill has already misled the person holding it.
  const asked =
    mode === "full" ? owed : mode === "split" ? (plan[done] ?? 0) : Number(typed) || 0;
  const amount = applyPayment(owed, asked, 0).food;
  const requestedTip = tipCustom ?? tipFor(amount, tipPct);
  const taken = applyPayment(owed, amount, requestedTip);
  const tip = taken.tip;
  const tipTooLarge = requestedTip > amount;

  function divide(people: number): void {
    setMode("split");
    setPlan(suggestEqual(owed, people));
    setDone(0);
  }

  async function collect(method: "cash" | "card"): Promise<void> {
    if (tipTooLarge || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/table-payment/part", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId, expected: owed, currency, amount, tip, method, ref }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        paymentCheck.capture(data, { kind: "table", tableId, currency });
        toast(data.error ?? t("settle.failed"), "error");
        if (data.code === "balance_changed" || data.code === "split") { setPlan([]); setDone(0); setMode("full"); await load(); }
        return;
      }

      onCollected();
      setRef(newRef());
      setTipPct(0);
      setTipCustom(null);
      setTyped("");

      if (data.settled) {
        toast(t("settle.recorded", { amount: formatMoney(data.amount, data.currency), tip: formatMoney(data.tip, data.currency) }));
        onClose();
        return;
      }

      setBill({
        ordered: data.ordered,
        collected: data.collected,
        tips: data.tips,
        owed: data.owed,
        currency: data.currency,
      });
      setDone(n => n + 1);
      toast(
        t("settle.collectedRecorded", {
          amount: formatMoney(data.amount, data.currency),
          tip: formatMoney(data.tip, data.currency),
          left: formatMoney(data.owed ?? 0, currency),
        }),
      );
      await load();
    } catch {
      // Money, so it never queues: a collection replayed on reconnect is a
      // table charged twice. Refuse it and say why.
      toast(t("offline.blocked"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <Modal open={open && !writingOff} onClose={onClose} maxWidth={460} label={t("settle.parts")}>
      <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 12 }}>
        {t("settle.partsTitle", { label: tableLabel })}
      </h3>

      {paymentCheck.action}
      <SlotReceiptPrints receipts={receipts} />

      {lost ? (
        <><p className="tt-muted">{t("settle.failed")}</p><button type="button" className="tt-btn tt-btn-ghost" onClick={load}>{t("settle.retry")}</button></>
      ) : !bill ? (
        <p className="tt-muted">{t("common.loading")}</p>
      ) : owed <= 0 ? (
        <p className="tt-muted">{t("settle.nothing")}</p>
      ) : (
        <>
          {(bill.balances?.length ?? 0) > 1 && <div role="group" aria-label={t("settle.currency")}>
            {bill.balances?.filter(b => b.owed > 0).map(b => <button key={b.currency} className="tt-tip-chip" disabled={busy} onClick={() => {
              setChosenCurrency(b.currency); setMode("full"); setPlan([]); setDone(0); setTipCustom(null); setTipPct(0);
            }}>{formatMoney(b.owed, b.currency)}</button>)}
          </div>}
          <div className="tt-calc-figures">
            <div className="tt-row">
              <span className="tt-muted">{t("settle.total")}</span>
              <span>{formatMoney(balance?.ordered ?? 0, currency)}</span>
            </div>
            {(balance?.collected ?? 0) > 0 && (
              <div className="tt-row">
                <span className="tt-muted">{t("settle.collected")}</span>
                <span className="tt-save">−{formatMoney(balance?.collected ?? 0, currency)}</span>
              </div>
            )}
            <div className="tt-bill-total tt-row">
              <strong>{t("settle.owed")}</strong>
              <strong style={{ fontSize: 18 }}>{formatMoney(owed, currency)}</strong>
            </div>
          </div>

          {splits.some(s => s.currency === currency) ? <TableSplitCollection canApprove={canApprove} onWriteOff={setWritingOff} splits={splits.filter(s => s.currency === currency)} remaining={owed} refresh={refreshBill} onCollected={onCollected} onReceipt={rememberReceipt} /> : <>
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
          {tipTooLarge && <p className="tt-field-error" role="alert">{t("tip.tooLarge", { max: formatMoney(amount, currency) })}</p>}
          <CashChange amount={taken.amount} currency={currency} />

          <div className="tt-bill-actions">
            <button
              className="tt-btn tt-btn-primary tt-btn-lg"
              style={{ width: "100%" }}
              disabled={busy || amount <= 0 || tipTooLarge}
              data-whole-bill-collect
              onClick={() => collect("cash")}
            >
              {t("settle.cash")} · {formatMoney(taken.amount, currency)}
            </button>
            <button
              className="tt-btn tt-btn-ghost tt-btn-lg"
              style={{ width: "100%", marginTop: 8 }}
              disabled={busy || amount <= 0 || tipTooLarge}
              data-whole-bill-collect
              onClick={() => collect("card")}
            >
              {t("settle.card")} · {formatMoney(taken.amount, currency)}
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
          </>}
        </>
      )}
    </Modal>
    {open && writingOff && <SplitWriteOffDialog split={writingOff} orders={orders} canApprove={canApprove}
      onRefresh={refreshBill} onClose={() => setWritingOff(null)} onApplied={() => { void load(); onCollected(); }} />}
    </>
  );
}
