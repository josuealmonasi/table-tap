import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  ops: [] as { table: string; op: string; value?: Record<string, unknown> }[],
  calls: [] as { name: string; args: Record<string, unknown> }[],
  ticket: null as Record<string, unknown> | null,
  lost: false,
  reply: null as Record<string, unknown> | null,
}));
const id = "6b1f0c2e-0000-4000-8000-000000000001";
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => {
    const q: Record<string, unknown> = {};
    for (const key of ["select", "eq", "in"]) q[key] = () => q;
    for (const op of ["insert", "update", "delete"]) q[op] = (value?: Record<string, unknown>) => {
      state.ops.push({ table, op, value }); return q;
    };
    const result = () => ({ data: table === "orders" ? state.ticket : table === "restaurants"
      ? { currency: "MXN", service_pct: 0, tax_pct: 0 } : [], error: null });
    q.single = q.maybeSingle = async () => result();
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return q;
  },
  rpc: async (name: string, args: Record<string, unknown>) => {
    state.calls.push({ name, args });
    if (state.reply) return { data: state.reply, error: null };
    state.ticket = { id: args.p_ref, total: 100, paid: name !== "ring_pos_account_v2", status: "completed",
      ...(name === "ring_pos_account_v2" ? { account_id: "a", charged_at: "now", customer_accounts: { name: "Guest" } } : {}) };
    if (state.lost) return { data: null, error: { message: "response lost after commit" } };
    return { data: { outcome: "settled", orderId: args.p_ref, total: 100, settled: true, ...(name === "ring_pos_account_v2" ? { onAccount: { name: "Guest", owed: 100 } } : {}) }, error: null };
  },
}) }));
vi.mock("@/lib/api-error", () => ({
  apiError: async (error: string, status: number, _vars?: unknown, extra?: Record<string, unknown>) =>
    Response.json({ ...extra, error }, { status }),
}));
vi.mock("@/lib/api-guard", () => ({ actingStaff: async () => ({ restaurantId: "r1", email: "cashier", role: "owner" }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, planBlocks: async () => null }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ limits: {} }) }));
vi.mock("@/lib/plan", () => ({ can: () => true }));
vi.mock("@/lib/promotions-on-sale", () => ({ promotionsOnSale: async () => [] }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/checkout/orderable-now", () => ({ orderableNow: async () => ({ closedNow: false, onOpenMenu: () => true }) }));
vi.mock("@/lib/checkout/verified-lines", () => ({ verifiedLines: async () => ({ ok: true, lines: [{ itemId: "x", name: "Dish", price: 100, qty: 1 }] }) }));
vi.mock("@/lib/stock-service", () => ({ reserveStock: async () => ({ ok: true, low: [], reservationId: null }), releaseStock: async () => {}, raiseStockNotifications: async () => {} }));
vi.mock("@/lib/pos-receipt", () => ({ saleReceipt: async () => ({}) }));
vi.mock("@/lib/accounts-server", () => ({ accountById: async () => ({ id: "a", name: "Guest" }) }));
vi.mock("@/lib/account-charge", () => ({ chargeAccount: async () => ({ outcome: "charged", amount: 100, owed: 100 }), currencyOf: async () => "MXN", chargeRefusal: async () => Response.json({}, { status: 409 }) }));

const { ringOffline } = await import("@/lib/pos-offline");
const { POST } = await import("@/app/api/pos/order/route");
const actor = { restaurantId: "r1", email: "cashier", role: "owner" } as Parameters<typeof ringOffline>[0];
const body = () => ({ posRef: id, method: "cash" as const, items: [{ itemId: "x", name: "Dish", price: 100, qty: 1, mods: {}, emoji: "" }], offline: { at: new Date().toISOString(), subtotal: 100, serviceFee: 0, tip: 0, discount: 0, total: 100 } });
beforeEach(() => { state.ops = []; state.calls = []; state.ticket = null; state.lost = false; state.reply = null; });

it("W1.1 keeps a committed offline sale when its response is lost", async () => {
  state.lost = true;
  await ringOffline(actor, body());
  expect(state.ops.filter(o => o.op === "delete")).toEqual([]);
  expect(state.calls.map(c => c.name)).toEqual(["ring_pos_sale_v2"]);
  state.lost = false;
  const replay = await ringOffline(actor, body());
  expect(await replay.json()).toMatchObject({ orderId: id, total: 100, settled: true, repeat: true });
  expect(state.calls).toHaveLength(1);
});
it("W1.6 commits offline stock and money in the same RPC", async () => {
  const res = await ringOffline(actor, body());
  expect(res.status).toBe(200);
  expect(state.calls.map(c => c.name)).toEqual(["ring_pos_sale_v2"]);
  expect(state.calls[0].args.p_demand).toEqual([{ item_id: "x", qty: 1 }]);
  expect(state.ops.filter(o => o.op === "insert")).toEqual([]);
});
it("W1.5 uses the device reference as the online order identity", async () => {
  const { offline: _, ...online } = body(); void _;
  await POST(new NextRequest("http://localhost/api/pos/order", { method: "POST", body: JSON.stringify(online) }));
  expect(state.calls.find(c => c.name === "ring_pos_sale_v2")?.args.p_ref).toBe(id);
});
it("W1.7 never publishes an account ticket before atomic credit approval", async () => {
  const { offline: _, ...online } = body(); void _;
  await POST(new NextRequest("http://localhost/api/pos/order", { method: "POST", body: JSON.stringify({ ...online, method: "account", accountId: id }) }));
  expect(state.ops.filter(o => o.table === "orders" && o.op === "insert")).toEqual([]);
  expect(state.calls.find(c => c.name === "ring_pos_account_v2")?.args.p_ref).toBe(id);
});

it("refuses an online collected amount that differs before recording money", async () => {
  const { offline: collected, ...online } = body();
  const res = await POST(new NextRequest("http://localhost/api/pos/order", { method: "POST", body: JSON.stringify({
    ...online, collected: { ...collected, subtotal: 80, total: 80 },
  }) }));
  expect(res.status).toBe(409);
  expect(state.calls).toEqual([]);
});
it("a till opened for another restaurant is refused and kept, online or replayed", async () => {
  const { offline: collected, ...online } = body();
  for (const sent of [{ ...online, collected }, body()]) {
    const res = await POST(new NextRequest("http://localhost/api/pos/order", { method: "POST", body: JSON.stringify({
      ...sent, restaurantId: "r2",
    }) }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "apiErr.posOtherRestaurant", held: true });
  }
  expect(state.calls).toEqual([]);
});
it("a till that names its own restaurant, or none (opened before this check), rings as before", async () => {
  const { offline: collected, ...online } = body();
  for (const restaurantId of ["r1", undefined]) {
    const res = await POST(new NextRequest("http://localhost/api/pos/order", { method: "POST", body: JSON.stringify({
      ...online, collected, posRef: crypto.randomUUID(), restaurantId,
    }) }));
    expect(res.status).toBe(200);
  }
});
it("a replay charged in another currency is refused and kept, never relabelled", async () => {
  const res = await ringOffline(actor, { ...body(), currency: "USD" });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "apiErr.offlineCurrency", held: true });
  expect(state.calls).toEqual([]);
});
it("a replay in the restaurant's currency, or from a till that sent none, rings as before", async () => {
  for (const currency of ["MXN", undefined]) {
    const res = await ringOffline(actor, { ...body(), posRef: crypto.randomUUID(), currency });
    expect(res.status).toBe(200);
  }
});
it("a replay records the lines as sold and takes a combo's parts from stock", async () => {
  const items = [{ itemId: "promo-1", name: "Combo", price: 90, qty: 2, mods: {}, emoji: "", comboId: "promo-1",
    components: [{ itemId: "burger", name: "Burger", emoji: "", qty: 1 }, { itemId: "fries", name: "Fries", emoji: "", qty: 1 }] }];
  await ringOffline(actor, { ...body(), posRef: crypto.randomUUID(), items });
  const args = state.calls.find(c => c.name === "ring_pos_sale_v2")?.args as { p_order: { items: { price: number }[] }; p_demand: unknown };
  expect(args.p_order.items[0].price).toBe(90);
  expect(args.p_demand).toEqual(expect.arrayContaining([
    expect.objectContaining({ item_id: "burger", qty: 2 }), expect.objectContaining({ item_id: "fries", qty: 2 }),
  ]));
});
it("a foreign reference conflict reveals no ticket or total", async () => {
  state.reply = { outcome: "conflict" };
  const res = await ringOffline(actor, body());
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "apiErr.posUnsettled" });
  expect(state.ops).toEqual([]);
});
it("an atomic account refusal never causes a second cleanup request", async () => {
  state.reply = { outcome: "limit", owed: 90, limit: 100 };
  const { offline: _, ...online } = body(); void _;
  const res = await POST(new NextRequest("http://localhost/api/pos/order", { method: "POST", body: JSON.stringify({ ...online, method: "account", accountId: id }) }));
  expect(res.status).toBe(409);
  expect(state.ops).toEqual([]);
  expect(state.calls.map(c => c.name)).toEqual(["ring_pos_account_v2"]);
});

it("a lost online response replays as the same settled offline identity", async () => {
  state.lost = true;
  const { offline: collected, ...online } = body();
  const first = await POST(new NextRequest("http://localhost/api/pos/order", { method: "POST", body: JSON.stringify({ ...online, collected }) }));
  expect(first.status).toBe(503);
  state.lost = false;
  const replay = await ringOffline(actor, body());
  expect(await replay.json()).toMatchObject({ orderId: id, total: 100, settled: true, repeat: true });
  expect(state.calls).toHaveLength(1);
  expect(state.ops).toEqual([]);
});
it("a lost account approval response returns its approved ticket on retry", async () => {
  state.lost = true;
  const { offline: _, ...online } = body(); void _;
  const request = () => new NextRequest("http://localhost/api/pos/order", { method: "POST", body: JSON.stringify({ ...online, method: "account", accountId: id }) });
  expect((await POST(request())).status).toBe(503);
  state.lost = false;
  expect(await (await POST(request())).json()).toMatchObject({ settled: true, repeat: true, onAccount: { name: "Guest" } });
  expect(state.calls).toHaveLength(1);
});
