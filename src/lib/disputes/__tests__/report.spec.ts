import { expect, it } from "vitest";
import { disputeReport, minorUnits, tenantBooks } from "../report";
import { dispute, movement } from "./report-fixtures";

const since = "2026-11-01T00:00:00.000Z", until = "2026-12-01T00:00:00.000Z";
it("includes current withdrawal of an old sale, separating principal, fees and net", () => {
  expect(disputeReport([dispute], [movement], since, until, 1)).toEqual({ currencies: [{ currency: "MXN", withdrawn: -100,
    reinstated: 0, fees: 15, net: -115, exposure: 0 }], pending: 1, won: 1, lost: 0 });
});
it("a win does not invent credits, reverse sales or erase fees", () => {
  const report = disputeReport([dispute], [movement, { ...movement, stripe_balance_transaction_id: "credit",
    amount_minor: 10000, fee_minor: 0, net_minor: 10000 }], since, until, 0);
  expect(report.currencies[0]).toMatchObject({ net: -15, fees: 15, withdrawn: -100, reinstated: 100 });
});
it("keeps charge exposure and settlement money in their own currencies", () => {
  const report = disputeReport([{ ...dispute, status: "under_review", currency: "USD" }], [movement], since, until, 0);
  expect(report.currencies).toEqual([{ currency: "MXN", withdrawn: -100, reinstated: 0, fees: 15, net: -115, exposure: 0 },
    { currency: "USD", withdrawn: 0, reinstated: 0, fees: 0, net: 0, exposure: 100 }]);
});
it("uses half-open provider-date windows with zero-sales periods and actual fee credits", () => {
  const credit = { ...movement, amount_minor: 0, fee_minor: -500, net_minor: 500 };
  expect(disputeReport([], [credit, { ...movement, provider_created_at: until }, { ...movement, provider_created_at: "2026-10-31" }], since, until, 0).currencies[0])
    .toMatchObject({ net: 5, fees: -5 });
});
it("respects zero and three-decimal settlement currencies", () => {
  expect(minorUnits(123, "JPY")).toBe(123);
  expect(minorUnits(123, "KWD")).toBe(0.123);
});
it("a review case (no matched sale) adds nothing to the tenant's totals, exposure or outcomes", () => {
  const review = { ...dispute, id: "review", status: "lost", reconciliation_state: "review" };
  const open = { ...dispute, id: "review_open", status: "needs_response", reconciliation_state: "review" };
  const reviewMoney = [{ ...movement, dispute_id: "review", stripe_balance_transaction_id: "txn_review", amount_minor: -50000, fee_minor: 1500, net_minor: -51500 },
    { ...movement, dispute_id: "review_open", stripe_balance_transaction_id: "txn_open", currency: "USD" }];
  const own = disputeReport([dispute], [movement], since, until, 0);
  expect(disputeReport([dispute, review, open], [movement, ...reviewMoney], since, until, 0)).toEqual(own);
  expect(disputeReport([review, open], reviewMoney, since, until, 0)).toEqual({ currencies: [], pending: 0, won: 0, lost: 0 });
  expect(tenantBooks([dispute, review, open], [movement, ...reviewMoney])).toEqual({ cases: [dispute], movements: [movement] });
});
