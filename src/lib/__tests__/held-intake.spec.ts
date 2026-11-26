import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CART_LINES, MAX_TILL_LINES } from "@/lib/cart-limits";
import { round2 } from "@/lib/money";
import type { Actor } from "@/lib/api-guard";
import type { PosSaleBody } from "@/lib/pos-sale";
import { receiveOffline } from "@/lib/offline-intake";
import { ringOffline } from "@/lib/pos-offline";

const state = vi.hoisted(() => ({ calls: [] as { name: string; args: Record<string, unknown> }[] }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number, _: unknown, extra: object) => Response.json({ error, ...extra }, { status }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, planBlocks: async () => null }));
vi.mock("@/lib/public-menu-cache", () => ({ invalidatePublicMenu: vi.fn() }));
vi.mock("@/lib/offline-authority", () => ({ readOfflineContext: () => null }));
vi.mock("@/lib/offline-pricing", () => ({ currentOfflinePrice: async () => null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === "restaurants" ? { suspended_at: null } : null }),
      single: async () => ({ data: table === "restaurants" ? { currency: "MXN" } : null }) };
    return q;
  },
  rpc: async (name: string, args: Record<string, unknown>) => {
    state.calls.push({ name, args });
    return { data: name === "queue_offline_sale" ? { queued: true, receipt: args.p_body }
      : { outcome: "settled", settled: true, orderId: args.p_ref } };
  },
}) }));
const actor: Actor = { restaurantId: "r", role: "manager", email: "manager@example.com" };
const receipt = () => ({ posRef: "c7ab3000-0000-4000-8000-000000000011", method: "cash", currency: "MXN",
  items: [{ itemId: "dish", name: "Soup", price: 12.5, qty: 1, mods: {} }],
  offline: { at: new Date().toISOString(), subtotal: 12.5, serviceFee: 0, tip: 0, discount: 0, total: 12.5 } });
const intake = (raw: unknown) => receiveOffline(actor, raw as PosSaleBody & { offline: unknown }, true);
beforeEach(() => { state.calls = []; });

it.each(["note", "customerName"] as const)("refuses bad whole-order %s before writing", async key => {
  const res = await intake({ ...receipt(), [key]: key === "note" ? 123 : {} });
  expect({ status: res.status, body: await res.json(), writes: state.calls }).toEqual({
    status: 400, body: { error: "apiErr.offlineSale", held: true }, writes: [],
  });
});

const fields = ["subtotal", "serviceFee", "tip", "discount", "total"] as const;
it.each(fields.flatMap(key => ["12,50", "1,250.00", "12.50"].map(value => ({ key, value }))))(
  "refuses string $key=$value even when parsed amounts add up", async ({ key, value }) => {
    const amount = value === "1,250.00" ? 1250 : 12.5;
    const offline = { ...receipt().offline, subtotal: 0, total: amount, [key]: value };
    if (key === "discount") offline.subtotal = amount;
    if (key === "total") offline.subtotal = amount;
    const res = await intake({ ...receipt(), offline });
    expect({ status: res.status, body: await res.json(), writes: state.calls }).toEqual({
      status: 400, body: { error: "apiErr.offlineSale", held: true }, writes: [],
    });
  });

it.each(fields)("refuses sub-cent %s=1.005 before rounding", async key => {
  const offline = { ...receipt().offline, subtotal: 0, total: 1, [key]: 1.005 };
  if (key === "discount" || key === "total") offline.subtotal = 1;
  const res = await intake({ ...receipt(), offline });
  expect({ status: res.status, body: await res.json(), writes: state.calls }).toEqual({
    status: 400, body: { error: "apiErr.offlineSale", held: true }, writes: [],
  });
});

it("refuses tip 0.02 above total 0.01 despite the sum tolerance", async () => {
  const res = await intake({ ...receipt(), offline: { ...receipt().offline, subtotal: 0, tip: 0.02, total: 0.01 } });
  expect({ status: res.status, body: await res.json(), writes: state.calls }).toEqual({
    status: 400, body: { error: "apiErr.offlineSale", held: true }, writes: [],
  });
});

it("keeps float noise, optional text and exactly one cent of arithmetic tolerance", async () => {
  const sent = { ...receipt(), note: null, customerName: "  Mira  ",
    offline: { ...receipt().offline, subtotal: 0.1 + 0.2, total: 0.31 } };
  const res = await intake(sent);
  expect({ status: res.status, saved: state.calls[0]?.args.p_body }).toEqual({ status: 200, saved: sent });
});

it.each(["note", "customerName"] as const)("approves an existing bad %s without changing its raw receipt", async key => {
  const raw = { ...receipt(), note: "  No salt  ", customerName: "  Mira   Ray  ", [key]: key === "note" ? 123 : {} };
  const before = JSON.stringify(raw);
  const res = await ringOffline(actor, raw as unknown as PosSaleBody & { offline: unknown },
    { reason: "Paper receipt reviewed", collector: "original@example.com", currency: "MXN" });
  expect({ status: res.status, order: state.calls[0]?.args.p_order, raw: JSON.stringify(raw) }).toMatchObject({
    status: 200, order: { note: key === "note" ? null : "No salt", customer_name: key === "customerName" ? null : "Mira Ray" }, raw: before,
  });
});

it.each([{ extras: {} }, { extras: [null] }, { name: { poisoned: true } }])(
  "queues raw malformed lines and approves only their normalized projection: %j", async malformed => {
    const raw = { ...receipt(), items: [{ ...receipt().items[0], ...malformed }] };
    const before = JSON.stringify(raw);
    const queued = await intake(raw);
    const approved = await ringOffline(actor, raw as unknown as PosSaleBody & { offline: unknown },
      { reason: "Paper receipt reviewed", collector: "original@example.com", currency: "MXN" });
    const order = state.calls[1]?.args.p_order as { items: unknown };
    expect({ queued: queued.status, approved: approved.status, saved: state.calls[0]?.args.p_body, lines: order.items, raw: JSON.stringify(raw) }).toEqual({
      queued: 200, approved: 200, saved: raw, raw: before,
      lines: [{ ...receipt().items[0], emoji: "", extras: "extras" in malformed && Array.isArray(malformed.extras)
        ? [{ id: "", name: "", emoji: "", price: 0 }] : [], name: "name" in malformed ? "—" : "Soup" }],
    });
  });

describe("bl39 #4: a held receipt with more lines than a till sale may carry", () => {
  const wide = (n: number) => ({ ...receipt(), items: Array.from({ length: n }, (_, i) => ({ ...receipt().items[0], itemId: `dish-${i}`, price: 0.1, qty: 1 })),
    offline: { ...receipt().offline, subtotal: round2(n * 0.1), total: round2(n * 0.1) } });

  it("is queued for manager review instead of refused and stranded on the device", async () => {
    const raw = wide(MAX_TILL_LINES + 1);
    const res = await receiveOffline(actor, raw as unknown as PosSaleBody & { offline: unknown });
    expect(res.status).toBe(200);
    expect(state.calls.map(c => c.name)).toEqual(["queue_offline_sale"]);
    expect(state.calls[0].args).toMatchObject({ p_reason: "apiErr.offlineTooManyLines", p_body: raw });
  });

  it("is recorded with every one of its lines when a manager approves it", async () => {
    const raw = wide(MAX_TILL_LINES + 1);
    const res = await ringOffline(actor, raw as unknown as PosSaleBody & { offline: unknown },
      { reason: "Paper receipt reviewed", collector: "original@example.com", currency: "MXN" });
    expect(res.status).toBe(200);
    expect((state.calls[0].args.p_order as { items: unknown[] }).items).toHaveLength(MAX_TILL_LINES + 1);
  });

  it("past the cap every order route has, is still refused before any write", async () => {
    const res = await intake(wide(MAX_CART_LINES + 1));
    expect({ status: res.status, writes: state.calls }).toEqual({ status: 400, writes: [] });
  });
});
