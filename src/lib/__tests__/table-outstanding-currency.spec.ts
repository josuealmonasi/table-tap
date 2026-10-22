import { expect, it, vi } from "vitest";
const rows = [
  { id: "usd", currency: "USD", total: 100, tip: 0, paid: false, status: "completed", session_id: "s", table_label: "1" },
  { id: "mxn", currency: "MXN", total: 100, tip: 0, paid: false, status: "completed", session_id: "s", table_label: "1" },
];
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  let offset = 0;
  const q = { select: () => q, eq: () => q, is: () => q, neq: () => q, order: () => q,
    range: (a: number) => { offset = a; return q; },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: offset ? [] : rows, error: null }).then(resolve) };
  return q;
} }) }));
vi.mock("@/lib/payment-coverage", () => ({ paymentCoverageDetails: async (_restaurant: string, orders: { id: string }[]) =>
  new Map(orders.map(o => [o.id,{ amount: o.id === "usd" ? 20 : 30, tip: 0 }])) }));
import { tableOutstanding } from "@/lib/table-outstanding";
it("S21 separates a mixed sitting's original debts and their exact receipts", async () => {
  expect(await tableOutstanding("r","t")).toMatchObject({ currency: null, owed: 0, ordered: 0, collected: 0,
    balances: [{ currency: "USD", ordered: 100, collected: 20, owed: 80 }, { currency: "MXN", ordered: 100, collected: 30, owed: 70 }] });
  expect(await tableOutstanding("r","t","USD")).toMatchObject({ currency: "USD", owed: 80, ordered: 100, collected: 20,
    sittings: [{ id: "s", owed: 80 }] });
});
