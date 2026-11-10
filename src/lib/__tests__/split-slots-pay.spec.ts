const recover = vi.hoisted(() => vi.fn());
vi.mock("@/lib/split-page-recovery", () => ({ resolveSelectedSplitPages: recover }));
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const s = vi.hoisted(() => ({ revision: 1, paid: false, held: false, amount: 5500, currency: "MXN", prior: false,
  params: null as Record<string, unknown> | null, quote: null as Record<string, unknown> | null, fee: vi.fn(), waiter: vi.fn() }));
vi.mock("stripe", () => ({ default: class {} }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false, isTableLimited: async () => false }));
vi.mock("@/lib/table-membership", () => ({ tableMember: async () => ({ id: "m", sessionId: "session" }) }));
vi.mock("@/lib/table-session", () => ({ staffOpenedBill: s.waiter }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ limits: { fee_cap: 10 } }) }));
vi.mock("@/lib/site-origin", () => ({ siteOrigin: () => "http://localhost" }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number, _vars: unknown, extra: object) => Response.json({ error, ...extra }, { status }) }));
vi.mock("@/lib/platform-fee", () => ({ NO_FEE: { cents: 0, id: null }, reserveFeeCents: s.fee,
  feeMetadata: (f: { id: string; cents: number }) => ({ fee_id: f.id, fee_cents: String(f.cents) }) }));
vi.mock("@/lib/diner-attempt", () => ({
  resumeDinerAttempt: async () => s.prior ? { url: "original-page" } : null,
  openDinerAttempt: async (_stripe: unknown, params: Record<string, unknown>, quote: Record<string, unknown>) => {
    s.params = params; s.quote = quote; return { url: "new-page" };
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const data = table === "bill_splits" ? { id: "split", restaurant_id: "r", session_id: "session", model_version: 2, status: "locked",
    revision: s.revision, currency: s.currency, order_ids: ["o"], food_principal: 100 } : table === "restaurants"
    ? { name: "Restaurant", stripe_account_id: "acct", stripe_charges_enabled: true } : table === "bill_split_slots"
      ? [0, 1].map(share_no => ({ share_no, amount_cents: s.amount, fee_slice_cents: 150, payment_id: s.paid ? "p" : null, reserved_checkout_id: s.held ? "other" : null })) : { id: "session" };
  const q: Record<string, unknown> = {};
  for (const op of ["select", "eq", "in"]) q[op] = () => q;
  q.single = q.maybeSingle = async () => ({ data, error: null });
  q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
  return q;
} }) }));
const { POST } = await import("@/app/api/split/pay/route");
const body = { restaurantId: "r", tableId: "t", sessionId: "session", splitId: "split", revision: 1,
  slots: [1, 0], expectedCents: 11000, tipCents: 1000 };
const req = (data: unknown = body) => new NextRequest("http://localhost/api/split/pay", { method: "POST", body: JSON.stringify(data) });
beforeEach(() => { recover.mockReset().mockResolvedValue("unverified"); s.revision = 1; s.paid = false; s.held = false; s.amount = 5500; s.currency = "MXN"; s.prior = false;
  s.params = null; s.quote = null; s.fee.mockReset().mockResolvedValue({ id: "fee", cents: 125 }); s.waiter.mockReset().mockResolvedValue(true); });
it("staff-opened model 2 bill charges the selected parts plus new tip and reserves only their fee slices", async () => {
  expect((await POST(req())).status).toBe(200);
  expect(s.waiter).not.toHaveBeenCalled();
  expect(s.fee).toHaveBeenCalledWith("r", { fee_cap: 10 }, 300, "split");
  expect(s.params).toMatchObject({ line_items: [{ price_data: { unit_amount: 12000, currency: "mxn" } }],
    payment_intent_data: { application_fee_amount: 125 }, metadata: { split_model: "2", split_slots: "[0,1]", split_amount: "110", settle_tip: "10" } });
  expect(s.quote).toMatchObject({ amountCents: 12000, payableIds: [], foodPrincipal: 100, scopeKey: "split2:split:1:m:0,1" });
});
it("a retry returns its own persisted page before checking held slots", async () => {
  s.prior = true; s.held = true;
  const response = await POST(req({ ...body, tipCents: 2000 }));
  expect(await response.json()).toEqual({ url: "original-page" });
  expect(s.fee).not.toHaveBeenCalled();
});
it.each([["paid", "paid"], ["held", "taken"]] as const)("%s parts never reserve a second fee", async (flag, code) => {
  s[flag] = true;
  const response = await POST(req());
  expect(await response.json()).toMatchObject({ code });
  expect(s.fee).not.toHaveBeenCalled();
});
it("a stale revision cannot quote new slot prices", async () => {
  s.revision = 2;
  expect(await (await POST(req())).json()).toMatchObject({ code: "stale" });
  expect(s.fee).not.toHaveBeenCalled();
});
it("parts below Stripe's minimum combine without inflating the charge", async () => {
  s.amount = 100;
  expect(await (await POST(req({ ...body, expectedCents: 200, tipCents: 500 }))).json()).toMatchObject({ code: "below_minimum" });
  expect(s.fee).not.toHaveBeenCalled();
});
it("saved USD remains USD even if the menu's currency changes", async () => {
  s.currency = "USD";
  await POST(req());
  expect(s.params).toMatchObject({ line_items: [{ price_data: { currency: "usd" } }] });
});
it.each([{ slots: [0, 0] }, { slots: [null] }, { tipCents: 11001 }, { couponCode: "SAVE" }, { tipCents: Infinity }])("rejects malformed selection or tip %s", async change => {
  expect((await POST(req({ ...body, ...change }))).status).toBe(400);
  expect(s.fee).not.toHaveBeenCalled();
});

it("an expired selected reservation recovers before quoting the same parts and tip", async () => {
  s.held = true;
  recover.mockImplementation(async () => { s.held = false; return "closed"; });
  expect((await POST(req())).status).toBe(200);
  expect(recover).toHaveBeenCalledWith("r", "split", [0, 1]);
  expect(s.fee).toHaveBeenCalledTimes(1);
  expect(s.params).toMatchObject({ metadata: { split_slots: "[0,1]", settle_tip: "10" } });
});
