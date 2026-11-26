import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const state = vi.hoisted(() => ({ saved: [] as unknown[], down: false, tenant: "r1", currency: "MXN", binds: [] as string[], bindError: "" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: async (fn: string) => {
  state.binds.push(fn);
  return { data: null, error: state.bindError ? { message: state.bindError } : null };
}, from: (table: string) => {
  const b: Record<string, unknown> = {};
  let offset = 0;
  b.range = (from: number) => { offset = from; return b; };
  b.order = () => b;
  for (const m of ["select", "eq", "in"]) b[m] = () => b;
  b.single = async () => ({ data: { stripe_account_id: "acct_a" }, error: null });
  b.insert = async (record: unknown) => {
    if (!state.down) state.saved.push(record);
    return { error: state.down ? { message: "offline" } : null };
  };
  b.then = (resolve: (r: unknown) => void) => Promise.resolve({ data: table === "orders"
    ? offset > 0 ? [] : [{ id: "o1", restaurant_id: state.tenant, currency: state.currency }] : null, error: null }).then(resolve);
  return b;
} }) }));
const { recordDinerCheckout, stripeLiveMode } = await import("@/lib/diner-checkout");
const session = { id: "cs_ours", livemode: false, mode: "payment", currency: "mxn", amount_total: 10000,
  metadata: { order_id: "o1", restaurant_id: "r1" } } as unknown as Stripe.Checkout.Session;
const expected = { restaurantId: "r1", stripeAccount: "acct_a", currency: "MXN", amountCents: 10000, orderIds: ["o1"] };
beforeEach(() => { vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_provenance"); state.saved = []; state.binds = []; state.bindError = ""; state.down = false; state.tenant = "r1"; state.currency = "MXN"; });
it("saves fee-free session identity, amount, currency and order scope durably", async () => {
  const expire = vi.fn();
  await recordDinerCheckout(session, expected, expire);
  expect(state.saved).toEqual([expect.objectContaining({ stripe_session_id: "cs_ours", restaurant_id: "r1",
    stripe_account_id: "acct_a", amount_cents: 10000, currency: "MXN", order_ids: ["o1"], metadata: session.metadata })]);
  expect(expire).not.toHaveBeenCalled();
});
it("expires a newly created session if saving its provenance fails", async () => {
  state.down = true;
  const expire = vi.fn(async () => {});
  await expect(recordDinerCheckout(session, expected, expire)).rejects.toThrow("save checkout provenance");
  expect(expire).toHaveBeenCalledOnce();
  expect(state.saved).toEqual([]);
});
it.each([{ amountCents: 1 }, { stripeAccount: "acct_other" }, { currency: "USD" }, { currency: "JPY" }])("refuses a session different from the server's quote: %s", async change => {
  const expire = vi.fn(async () => {});
  await expect(recordDinerCheckout(session, { ...expected, ...change }, expire)).rejects.toThrow();
  expect(state.saved).toEqual([]);
  expect(expire).toHaveBeenCalledOnce();
});
// bl43 #2: a retry retired the attempt (share, coupon and fee given back)
// while the first request's page was still being made. That late page must be
// expired, never bound and shown.
it("binds an attempt's page only through the open-attempt bind, and expires a page it refuses", async () => {
  const expire = vi.fn(async () => {});
  await recordDinerCheckout(session, { ...expected, attemptId: "attempt" }, expire);
  expect(state.binds).toEqual(["diner_checkout_bind_open_v1"]);
  expect(expire).not.toHaveBeenCalled();
  state.bindError = "checkout_attempt_closed";
  await expect(recordDinerCheckout(session, { ...expected, attemptId: "attempt" }, expire)).rejects.toThrow("checkout_attempt_closed");
  expect(expire).toHaveBeenCalledOnce();
});
it("the open-attempt bind refuses a retired attempt and keeps a paid one's own page", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/schema.sql"), "utf8");
  const body = sql.split("create or replace function public.diner_checkout_bind_open_v1(p_attempt uuid, p_record jsonb)")[1]?.split("end; $$;")[0] ?? "";
  expect(body).toContain("if c.status <> 'open' then raise exception 'checkout_attempt_closed'; end if;");
  expect(body.indexOf("checkout_attempt_closed")).toBeLessThan(body.indexOf("update diner_checkouts set stripe_session_id"));
  expect(body).toContain("if c.status = 'paid' and c.stripe_session_id = p_record->>'stripe_session_id' then return; end if;");
  expect(readFileSync(join(process.cwd(), "supabase/drop.sql"), "utf8")).toContain("drop function if exists public.diner_checkout_bind_open_v1(uuid, jsonb);");
});
it("never records another restaurant's food as this account's checkout", async () => {
  state.tenant = "r2";
  await expect(recordDinerCheckout(session, expected, async () => {})).rejects.toThrow("scope");
  expect(state.saved).toEqual([]);
});
it.each([["sk_live_x", true], ["sk_test_x", false], ["rk_live_x", true], ["rk_test_x", false]])("uses secret key mode %s", (key, live) => {
  vi.stubEnv("STRIPE_SECRET_KEY", key);
  expect(stripeLiveMode()).toBe(live);
});
it("refuses an unknown key mode rather than treating it as test", () => {
  vi.stubEnv("STRIPE_SECRET_KEY", "");
  expect(() => stripeLiveMode()).toThrow("mode");
});
