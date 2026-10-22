import { expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  let offset = 0;
  const q = { select: () => q, eq: () => q, in: () => q, order: () => q,
    range: (a: number) => { offset = a; return q; },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: offset ? [] : [{ id: "usd",currency: "USD" },{ id: "mxn",currency: "MXN" }], error: null }).then(resolve) };
  return q;
} }) }));
import { billRequestCurrencies } from "@/lib/bill-request-currency";
it("S21 approvals use their orders' currency and refuse to guess for missing or mixed orders", async () => {
  const currencies = await billRequestCurrencies("r",[
    { id: "one",order_ids: ["usd"] },{ id: "two",order_ids: ["mxn"] },
    { id: "mixed",order_ids: ["usd","mxn"] },{ id: "missing",order_ids: ["old"] },
  ]);
  expect([...currencies]).toEqual([["one","USD"],["two","MXN"],["mixed",null],["missing",null]]);
});
