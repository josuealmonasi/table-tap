import { beforeEach, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  diners: [] as Record<string, unknown>[], accounts: [] as Record<string, unknown>[],
  calls: [] as { name: string; args: unknown }[], filters: [] as unknown[][],
  after: "expired", error: false, releaseError: false,
}));
const { retrieve, resume, abandon } = vi.hoisted(() => ({ retrieve: vi.fn(), resume: vi.fn(), abandon: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ stripe: { checkout: { sessions: { retrieve } } } }));
vi.mock("@/lib/checkout-abandon", () => ({ abandonCheckout: abandon }));
vi.mock("@/lib/diner-attempt", () => ({ resumeDinerAttempt: resume }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (name: string, args: unknown) => {
    s.calls.push({ name, args });
    return { data: name === "retire_split_attempt_v1" ? { outcome: "retired" } : null,
      error: s.releaseError ? { message: "release failed" } : null };
  },
  from: (table: string) => {
    const q: Record<string, unknown> = {};
    let start = 0, end = 499;
    for (const op of ["select", "eq", "is", "in", "overlaps", "contains", "range", "order"]) {
      q[op] = (...args: unknown[]) => { s.filters.push([table, op, ...args]); return q; };
    }
    q.maybeSingle = async () => ({ data: { ...s.diners[0], status: s.after }, error: s.error ? { message: "read failed" } : null });
    q.range = (from: number, to: number) => { start = from; end = to; return q; };
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({
      data: (table === "diner_checkouts" ? s.diners : table === "account_checkouts" ? s.accounts : [{ id: "o1" }]).slice(start, end + 1),
      error: s.error ? { message: "read failed" } : null,
    }).then(resolve);
    return q;
  },
}) }));
// This is the shared resolver contract, not a test of the split-only adapter.
const pages = await import("@/lib/whole-bill-pages");
const resolve = () => pages.resolveCheckoutPages("r1", { orderIds: ["o1"] });
const page = { id: "attempt", stripe_session_id: "cs_saved", stripe_account_id: "acct_saved", split_id: null, metadata: { restaurant_id: "r1" }, restaurant_id: "r1", currency: "MXN", amount_cents: 10000, livemode: false, order_ids: ["o1"] };
beforeEach(() => {
  vi.clearAllMocks(); s.diners = [page]; s.accounts = []; s.calls = []; s.filters = [];
  s.after = "expired"; s.error = false; s.releaseError = false;
  retrieve.mockImplementation(async () => ({ id: "cs_saved", status: "expired", payment_status: "unpaid", mode: "payment", livemode: false, currency: "mxn", amount_total: 10000, metadata: s.diners[0]?.metadata }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
it("closes an ordinary attempt only as unpaid on its saved connected account", async () => {
  expect(await resolve()).toBe("closed");
  expect(retrieve).toHaveBeenCalledWith("cs_saved", {}, { stripeAccount: "acct_saved" });
  expect(s.calls).toEqual([{ name: "finish_diner_checkout", args: { p_attempt: "attempt", p_paid: false } }]);
});
it("releases an expired account checkout through its own attempt and account release path", async () => {
  s.diners = [{ ...page, metadata: { restaurant_id: "r1", account_checkout: "account-page" } }];
  s.accounts = [{ id: "account-page", stripe_session_id: "cs_saved", order_ids: ["o1"] }];
  expect(await resolve()).toBe("closed");
  expect(s.calls).toContainEqual({ name: "account_checkout_release", args: { p_checkout: "account-page" } });
});
it("cannot verify an account page without its saved connected account", async () => {
  s.diners = []; s.accounts = [{ id: "account-page", stripe_session_id: "cs_legacy", order_ids: ["o1"] }];
  expect(await resolve()).toBe("unverified");
  expect(retrieve).not.toHaveBeenCalled(); expect(s.calls).toEqual([]);
});
it.each(["open", "complete"])("leaves a %s page unresolved and never records payment", async status => {
  retrieve.mockImplementation(async () => ({ id: "cs_saved", status, payment_status: status === "complete" ? "paid" : "unpaid", mode: "payment", livemode: false, currency: "mxn", amount_total: 10000, metadata: s.diners[0]?.metadata }));
  expect(await resolve()).toBe("unresolved"); expect(s.calls).toEqual([]);
});
it("cannot verify unreadable Stripe or a failed page read", async () => {
  retrieve.mockRejectedValue(new Error("network"));
  expect(await resolve()).toBe("unverified");
  s.error = true; expect(await resolve()).toBe("unverified"); expect(s.calls).toEqual([]);
});
it("cannot claim closure after a failed release", async () => {
  s.releaseError = true; expect(await resolve()).toBe("unverified");
});
it("retires an expired part atomically instead of finishing it as an ordinary bill", async () => {
  s.diners = [{ ...page, split_id: "split", metadata: { restaurant_id: "r1", split_model: "2" } }];
  expect(await resolve()).toBe("closed");
  expect(s.calls).toEqual([{ name: "retire_split_attempt_v1", args: { p_restaurant: "r1", p_checkout: "attempt" } }]);
});
it("replays a recent unbound page by its saved scope, and reads the resulting status", async () => {
  s.diners = [{ ...page, stripe_session_id: null, scope_key: "scope", created_at: new Date().toISOString() }];
  expect(await resolve()).toBe("closed"); expect(resume).toHaveBeenCalledWith(expect.anything(), "r1", "scope", "attempt");
});
it("keeps a 30-hour unbound page unverified without replaying a discarded Stripe key", async () => {
  s.diners = [{ ...page, stripe_session_id: null, scope_key: "scope", created_at: new Date(Date.now() - 30 * 3600_000).toISOString() }];
  expect(await resolve()).toBe("unverified"); expect(resume).not.toHaveBeenCalled(); expect(s.calls).toEqual([]);
});

it.each([
  { id: "cs_wrong" }, { mode: "subscription" }, { livemode: true }, { amount_total: 9999 },
  { currency: "usd" }, { metadata: { restaurant_id: "another-restaurant" } },
])("cannot close a page whose saved provenance differs (%#)", async mismatch => {
  retrieve.mockResolvedValue({ id: "cs_saved", status: "expired", payment_status: "unpaid", mode: "payment",
    livemode: false, currency: "mxn", amount_total: 10000, metadata: page.metadata, ...mismatch });
  expect(await resolve()).toBe("unverified"); expect(s.calls).toEqual([]);
});
it("a paid contradiction cannot be treated as expiry", async () => {
  retrieve.mockResolvedValue({ id: "cs_saved", status: "expired", payment_status: "paid", mode: "payment",
    livemode: false, currency: "mxn", amount_total: 10000, metadata: page.metadata });
  expect(await resolve()).toBe("unresolved"); expect(s.calls).toEqual([]);
});
it("an expired pay-now cart uses full abandonment before another checkout can claim its stock", async () => {
  s.diners = [{ ...page, metadata: { restaurant_id: "r1", order_id: "o1" } }];
  expect(await resolve()).toBe("closed");
  expect(abandon).toHaveBeenCalledWith(expect.objectContaining({ id: "cs_saved" }), { account: "acct_saved", livemode: false });
  expect(s.calls).toEqual([]);
});
it("closing one page cannot bypass another open blocker", async () => {
  s.diners = [page, { ...page, id: "other", stripe_session_id: "cs_other" }];
  retrieve.mockImplementation(async id => ({ id, status: id === "cs_saved" ? "expired" : "open", payment_status: "unpaid",
    mode: "payment", livemode: false, currency: "mxn", amount_total: 10000, metadata: page.metadata }));
  expect(await resolve()).toBe("unresolved");
  expect(s.calls).toEqual([{ name: "finish_diner_checkout", args: { p_attempt: "attempt", p_paid: false } }]);
});

it("a selected reservation cannot retire another split's attempt", async () => {
  s.diners = [{ ...page, split_id: "other", metadata: { restaurant_id: "r1", split_id: "other", split_model: "2" } }];
  expect(await pages.resolveCheckoutPages("r1", { checkoutIds: ["attempt"], splitId: "selected" })).toBe("unverified");
  expect(retrieve).not.toHaveBeenCalled(); expect(s.calls).toEqual([]);
});

it("a status check distinguishes paid money without recording a payment", async () => {
  retrieve.mockResolvedValue({ id: "cs_saved", status: "complete", payment_status: "paid", mode: "payment",
    livemode: false, currency: "mxn", amount_total: 10000, metadata: page.metadata });
  expect(await pages.resolveCheckoutPages("r1", { orderIds: ["o1"] }, true)).toBe("paid");
  expect(s.calls).toEqual([]);
});

it("a status check names missing identity and never opens an unbound page", async () => {
  s.diners = [{ ...page, stripe_session_id: null, scope_key: "scope", created_at: new Date().toISOString() }];
  expect(await pages.resolveCheckoutPages("r1", { orderIds: ["o1"] }, true)).toBe("missing_identity");
  expect(resume).not.toHaveBeenCalled(); expect(s.calls).toEqual([]);
});

it("a status check closes verified expiry through the same unpaid cleanup", async () => {
  expect(await pages.resolveCheckoutPages("r1", { orderIds: ["o1"] }, true)).toBe("closed");
  expect(s.calls).toEqual([{ name: "finish_diner_checkout", args: { p_attempt: "attempt", p_paid: false } }]);
  expect(resume).not.toHaveBeenCalled();
});

it("an open page or failed provider read cannot become a closed status", async () => {
  retrieve.mockResolvedValue({ id: "cs_saved", status: "open", payment_status: "unpaid", mode: "payment",
    livemode: false, currency: "mxn", amount_total: 10000, metadata: page.metadata });
  expect(await pages.resolveCheckoutPages("r1", { orderIds: ["o1"] }, true)).toBe("unresolved");
  retrieve.mockRejectedValue(new Error("offline"));
  expect(await pages.resolveCheckoutPages("r1", { orderIds: ["o1"] }, true)).toBe("unverified");
  expect(s.calls).toEqual([]);
});

it("missing connected identity asks for a manager without reading Stripe", async () => {
  s.diners = [{ ...page, stripe_account_id: null }];
  expect(await pages.resolveCheckoutPages("r1", { orderIds: ["o1"] }, true)).toBe("missing_identity");
  expect(retrieve).not.toHaveBeenCalled(); expect(s.calls).toEqual([]);
});

it("a mismatched paid page cannot tell staff that the customer paid", async () => {
  retrieve.mockResolvedValue({ id: "cs_wrong", status: "complete", payment_status: "paid", mode: "payment",
    livemode: false, currency: "mxn", amount_total: 10000, metadata: page.metadata });
  expect(await pages.resolveCheckoutPages("r1", { orderIds: ["o1"] }, true)).toBe("unverified");
  expect(s.calls).toEqual([]);
});
