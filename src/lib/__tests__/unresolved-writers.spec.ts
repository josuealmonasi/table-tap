import { beforeEach, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  filters: [] as unknown[][], status: "expired", readError: false, closed: false,
}));
const retrieve = vi.hoisted(() => vi.fn());
vi.mock("@/lib/stripe", () => ({ stripe: { checkout: { sessions: { retrieve } } } }));
vi.mock("@/lib/table-session", () => ({ closeSessionsFor: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    s.calls.push({ name, args });
    if (name === "finish_diner_checkout") { s.closed = true; return { data: null, error: null }; }
    if (name === "apply_bill_discount") return { data: s.closed ? "applied" : "paying", error: null };
    return { data: { outcome: s.closed ? (name === "account_charge_v2" ? "charged" : "written") : "paying", amount: 100, tip: 0, owed: 100 }, error: null };
  },
  from: (table: string) => {
    const q: Record<string, unknown> = {};
    let start = 0, end = 499;
    for (const op of ["select", "eq", "is", "in", "overlaps", "range", "order"]) {
      q[op] = (...args: unknown[]) => { s.filters.push([table, op, ...args]); return q; };
    }
    const result = () => ({ data: table === "orders" ? [{ id: "o1" }] : table === "diner_checkouts" ? [{
      id: "attempt", stripe_session_id: "cs_saved", stripe_account_id: "acct_saved", split_id: null,
      metadata: { restaurant_id: "r1" }, restaurant_id: "r1", currency: "MXN", amount_cents: 10000, livemode: false, order_ids: ["o1"], created_at: new Date(Date.now() - 36 * 60_000).toISOString(),
    }] : [], error: s.readError ? { message: "unavailable" } : null });
    q.range = (from: number, to: number) => { start = from; end = to; return q; };
    q.then = (resolve: (v: unknown) => unknown) => { const r = result(); return Promise.resolve({ ...r, data: r.data.slice(start, end + 1) }).then(resolve); };
    return q;
  },
}) }));
const { recordReviewed } = await import("@/lib/reviewed-collection");
const { chargeAccount } = await import("@/lib/account-charge");
const { applyToOrders } = await import("@/lib/apply-bill-discount");
const { applyWriteOff } = await import("@/lib/apply-write-off");
const { applyWriteOffRest } = await import("@/lib/write-off-rest");
const discount = () => applyToOrders([{ id: "o1" }] as never, "coupon", 10, "r1");
const writeOff = () => applyWriteOff({ orders: [{ id: "o1" }], restaurantId: "r1", actorEmail: "cashier", reason: "walkout", note: "" });
const remainder = () => applyWriteOffRest({ orders: [{ id: "o1" }], restaurantId: "r1", actorEmail: "cashier", reason: "walkout", note: "", expectedCents: 10000, currency: "MXN" });
const collect = () => recordReviewed({ restaurantId: "r1", email: "cashier" } as never,
  { tableId: "t1", expected: 100, currency: "MXN" }, 100, 0, "cash", "same-ref");
const charge = () => chargeAccount("r1", "account", ["o1"], 100, "cashier");
beforeEach(() => {
  s.calls = []; s.filters = []; s.closed = false; s.readError = false;
  retrieve.mockReset().mockResolvedValue({ id: "cs_saved", status: "expired", payment_status: "unpaid", mode: "payment", livemode: false, currency: "mxn", amount_total: 10000, metadata: { restaurant_id: "r1" } });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
it.each([collect, charge])("minute-36 expired page resolves before the identical writer is retried (%#)", async write => {
  await write();
  const attempts = s.calls.filter(c => c.name !== "finish_diner_checkout");
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  expect(retrieve).toHaveBeenCalledWith("cs_saved", {}, { stripeAccount: "acct_saved" });
  expect(s.calls).toContainEqual({ name: "finish_diner_checkout", args: { p_attempt: "attempt", p_paid: false } });
});
it.each([collect, charge])("a minute-36 paid page awaiting its webhook stays refused (%#)", async write => {
  retrieve.mockResolvedValue({ id: "cs_saved", status: "complete", payment_status: "paid", mode: "payment", livemode: false, currency: "mxn", amount_total: 10000, metadata: { restaurant_id: "r1" } });
  const result = await write();
  expect(result).toMatchObject(write === collect ? { paying: true } : { outcome: "paying" });
  expect(retrieve).toHaveBeenCalled();
  expect(s.calls).toHaveLength(1);
});
it.each([collect, charge])("unreadable Stripe keeps the writer refused (%#)", async write => {
  retrieve.mockRejectedValue(new Error("unreachable"));
  await write();
  expect(retrieve).toHaveBeenCalled();
  expect(s.calls).toHaveLength(1);
});

it.each([discount, writeOff, remainder])("every bill writer retries its original quote and reference after expiry (%#)", async write => {
  await write();
  const attempts = s.calls.filter(c => c.name !== "finish_diner_checkout");
  expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0]);
});
it("discount and write-off preserve the unresolved-page refusal", async () => {
  retrieve.mockResolvedValue({ id: "cs_saved", status: "complete", payment_status: "paid", mode: "payment", livemode: false, currency: "mxn", amount_total: 10000, metadata: { restaurant_id: "r1" } });
  expect(await discount()).toBe("paying");
  expect(await writeOff()).toEqual({ outcome: "paying" });
});
