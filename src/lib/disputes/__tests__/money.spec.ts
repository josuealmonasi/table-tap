import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { checkDisputes, disputeStructuralErrors } from "../../../../scripts/money-disputes.mjs";
const dispute = { id: "dp", restaurant_id: "r", livemode: true, stripe_account_id: "acct", verified_transaction_ids: ["debit", "credit"], reconciliation_state: "reconciled" };
const debit = { dispute_id: "dp", restaurant_id: "r", livemode: true, stripe_account_id: "acct", stripe_balance_transaction_id: "debit", amount_minor: -10000, fee_minor: 1500, net_minor: -11500, currency: "MXN" };
const credit = { ...debit, stripe_balance_transaction_id: "credit", amount_minor: 10000, fee_minor: 0, net_minor: 10000 };
it("the existing money gate runs the separate structural dispute checks", () => {
  expect(readFileSync("scripts/money-check.mjs", "utf8")).toContain("await checkDisputes(db, all, { ok, bad });");
  expect(disputeStructuralErrors([dispute], [debit, credit])).toEqual([]);
});
it.each([0, -11499, -11501])("rejects amount-fee != net (%s)", net_minor => {
  expect(disputeStructuralErrors([dispute], [{ ...debit, net_minor }, credit])).toContain("dispute arithmetic true:acct:debit");
});
it("detects a missing zero-net transaction even when aggregate net agrees", () => {
  const zero = { ...debit, stripe_balance_transaction_id: "zero", amount_minor: 0, fee_minor: 0, net_minor: 0 };
  expect(disputeStructuralErrors([{ ...dispute, verified_transaction_ids: ["debit", "credit", "zero"] }], [debit, credit])).toContain("dispute transaction set true:acct:dp");
  expect(disputeStructuralErrors([dispute], [debit, credit, zero])).toContain("dispute transaction set true:acct:dp");
});
it("detects duplicate evidence and substituted transactions with identical totals", () => {
  expect(disputeStructuralErrors([dispute], [debit, credit, debit])).toContain("duplicate dispute transaction true:acct:debit");
  expect(disputeStructuralErrors([dispute], [debit, { ...credit, stripe_balance_transaction_id: "substitute" }])).toContain("dispute transaction set true:acct:dp");
});
it.each([{ restaurant_id: "other" }, { stripe_account_id: "other" }, { livemode: false }])("rejects tenant/account/mode attribution drift %j", over => {
  expect(disputeStructuralErrors([dispute], [{ ...debit, ...over }, credit]).some(e => e.startsWith("dispute attribution"))).toBe(true);
});
it("never claims provider completeness, and reports pending evidence", async () => {
  const ok = vi.fn(), bad = vi.fn();
  const db = { from: (table: string) => ({ select: () => ({ table, neq: () => ({ table }) }) }) };
  const all = async (build: () => { table: string }) => ({ data: build().table === "stripe_disputes" ? [dispute]
    : build().table === "stripe_dispute_movements" ? [debit, credit] : [{ state: "error" }], error: null });
  await checkDisputes(db, all, { ok, bad });
  expect(bad).not.toHaveBeenCalled();
  expect(ok).toHaveBeenCalledWith(expect.stringContaining("provider completeness unverified"));
});
it("a failed read fails the gate", async () => {
  const bad = vi.fn();
  await checkDisputes({}, async () => ({ data: null, error: { message: "offline" } }), { ok: vi.fn(), bad });
  expect(bad).toHaveBeenCalledWith("cannot read dispute books: offline");
});
