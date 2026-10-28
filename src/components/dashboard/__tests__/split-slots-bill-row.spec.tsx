import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import OpenBillRow from "../OpenBillRow";
import type { OpenBill } from "@/lib/open-bills";
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
it("shows the real amount left after one slot is paid", () => {
  vi.stubGlobal("React", React);
  const bill: OpenBill = { tableId: "t", code: null, customerName: null, discount: 0, discounted: false, key: "t", orderIds: ["order"], items: [], tableLabel: "1", total: 100, collected: 50,
    split: { shares: 2, paidShares: 1 }, since: "2026-10-28", currency: "MXN" };
  const html = renderToStaticMarkup(<OpenBillRow bill={bill} currency="MXN" now={null} canSettle onOpen={vi.fn()} onCollect={vi.fn()} />);
  expect(html).toMatch(/tt-bill-total-cell[^>]*>[^<]*50/);
  vi.unstubAllGlobals();
});
