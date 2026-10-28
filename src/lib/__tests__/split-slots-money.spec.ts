import { expect, it } from "vitest";
import { splitSlotProblems } from "../../../scripts/money-split-slots.mjs";

interface Ledger {
  splits: Record<string, unknown>[]; slots: Record<string, unknown>[]; links: Record<string, unknown>[];
  attempts: Record<string, unknown>[]; receipts: Record<string, unknown>[]; allocations: Record<string, unknown>[];
  fees: Record<string, unknown>[]; refunds: Record<string, unknown>[];
}
function ledger(): Ledger {
  return {
    splits: [{ id: "s", restaurant_id: "r", session_id: "sit", model_version: 2, shares: 2, amount: 100,
      fee_budget_cents: 300, currency: "MXN", revision: 1, order_ids: ["o"] }],
    slots: [0, 1].map(share_no => ({ split_id: "s", restaurant_id: "r", share_no, amount_cents: 5000, fee_slice_cents: 150,
      payment_id: share_no === 0 ? "p" : null, reserved_checkout_id: null })),
    links: [{ checkout_id: "a", restaurant_id: "r", split_id: "s", share_no: 0, amount_cents: 5000, fee_slice_cents: 150 }],
    attempts: [{ id: "a", restaurant_id: "r", split_id: "s", split_revision: 1, status: "paid", amount_cents: 5500,
      currency: "MXN", stripe_payment_intent: "pi", metadata: { split_model: "2", settle_tip: "5", fee_id: "f", fee_cents: "150" } }],
    receipts: [{ id: "p", restaurant_id: "r", session_id: "sit", currency: "MXN", stripe_payment_intent: "pi", amount: 55, tip: 5 }],
    allocations: [{ payment_id: "p", restaurant_id: "r", order_id: "o", amount: 55, tip: 5 }],
    fees: [{ id: "f", restaurant_id: "r", cents: 150, status: "taken" }], refunds: [],
  };
}
it("reconciles slots, their exact attempt, receipt, tip, fee and allocations", () => {
  expect(splitSlotProblems(ledger())).toEqual([]);
});
it("catches a paid slot whose receipt vanished", () => {
  const data = ledger(); data.receipts = [];
  expect(splitSlotProblems(data).join(" ")).toMatch(/receipt/);
});
it("catches an attempt that paid without matching its slots", () => {
  const data = ledger(); data.attempts[0].amount_cents = 6000;
  expect(splitSlotProblems(data).join(" ")).toMatch(/amount/);
});
it("catches a fee taken from another slot or restaurant", () => {
  const data = ledger(); data.fees[0].cents = 300;
  expect(splitSlotProblems(data).join(" ")).toMatch(/fee/);
});
it("catches an allocation outside the frozen split", () => {
  const data = ledger(); data.allocations[0].order_id = "another-order";
  expect(splitSlotProblems(data).join(" ")).toMatch(/allocation/);
});
it("catches a held slot with no matching immutable checkout link", () => {
  const data = ledger(); data.slots[1].reserved_checkout_id = "missing";
  expect(splitSlotProblems(data).join(" ")).toMatch(/reservation/);
});
it("accepts a late paid attempt only when the full verified charge is owed back", () => {
  const data = ledger(); data.receipts = []; data.slots[0].payment_id = null;
  data.refunds = [{ stripe_payment_intent: "pi", restaurant_id: "r", currency: "MXN", amount: 55 }];
  expect(splitSlotProblems(data)).toEqual([]);
  data.refunds[0] = { stripe_payment_intent: "pi", restaurant_id: "r", currency: "MXN", amount: 50 };
  expect(splitSlotProblems(data).join(" ")).toMatch(/refund/);
});
