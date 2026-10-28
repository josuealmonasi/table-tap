import { expect, it } from "vitest";
import { withSplits, type OpenBill } from "@/lib/open-bills";
const bill = { key: "t:MXN", currency: "MXN", orderIds: ["old-order", "split-order"], total: 100, collected: 50 } as OpenBill;
it("finds slot progress on every sitting and only in the bill's currency", () => {
  const sessions = new Map([["old-order", "old"], ["split-order", "split-session"]]);
  const splits = [{ session_id: "split-session", shares: 2, paidShares: 1, currency: "MXN" }];
  const found = withSplits([bill, { ...bill, currency: "USD" }], splits, sessions);
  expect(found[0].split).toEqual({ shares: 2, paidShares: 1 });
  expect(found[1].split).toBeUndefined();
});
