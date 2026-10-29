import { beforeEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({ tables: [] as string[], model: 2, paid: true, held: true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  s.tables.push(table);
  const data = table === "bill_splits" ? { id: "split", model_version: s.model, revision: 1, shares: 2,
    status: "locked", amount: 110, proposed_by: "m", currency: "MXN", first_payment_attempt_at: null } :
    table === "bill_split_slots" ? [{ share_no: 0, amount_cents: 5500, fee_slice_cents: 150, payment_id: null, reserved_checkout_id: s.held ? "attempt" : null },
      { share_no: 1, amount_cents: 5500, fee_slice_cents: 150, payment_id: s.paid ? "payment" : null, reserved_checkout_id: null }] : [];
  const q: Record<string, unknown> = {};
  for (const op of ["select", "eq", "in", "order"]) q[op] = () => q;
  q.maybeSingle = async () => ({ data, error: null });
  q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
  return q;
} }) }));
vi.mock("@/lib/bill-data", () => ({ fetchTableBill: async () => [] }));
const { currentSplit } = await import("@/lib/split-service");
beforeEach(() => { s.tables = []; s.model = 2; s.paid = true; s.held = true; });
it("reads model 2 slots without asking legacy claims to describe them", async () => {
  const split = await currentSplit("session", "m", "r", "t", [],
    { id: "m", sessionId: "session", restaurantId: "r", tableId: "t", closed: false });
  expect(split).toMatchObject({ modelVersion: 2, revision: 1, currency: "MXN", frozen: true, slots: [
    { shareNo: 0, amountCents: 5500, feeCents: 150, paying: true, paid: false },
    { shareNo: 1, amountCents: 5500, feeCents: 150, paying: false, paid: true },
  ] });
  expect(s.tables).not.toContain("bill_split_claims");
});
it("still reads a legacy split through claims", async () => {
  s.model = 1;
  await currentSplit("session", "m", "r", "t", [],
    { id: "m", sessionId: "session", restaurantId: "r", tableId: "t", closed: false });
  expect(s.tables).toContain("bill_split_claims");
  expect(s.tables).not.toContain("bill_split_slots");
});

it.each([[true, false], [false, true], [false, false]])("diner freezes for paid=%s held=%s without an attempt timestamp", async (paid, held) => {
  s.paid = paid; s.held = held;
  const split = await currentSplit("session", "m", "r", "t", [],
    { id: "m", sessionId: "session", restaurantId: "r", tableId: "t", closed: false });
  expect(split?.frozen).toBe(paid || held);
});
