import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { issueOfflineContext } from "@/lib/offline-authority";
import { reviewSale, type QueuedOfflineSale } from "@/lib/offline-review";
import { replayBody, type HeldSale } from "@/lib/offline-sales";
import { messagesFor, translate } from "@/lib/i18n";
import { checkClosedShifts } from "../../../scripts/money-shifts.mjs";

// bl39 finding 2, the offline half: a cash sale taken at 11:59 on a tablet
// without a connection (or with a clock three minutes fast) was dated by the
// device and landed in whichever shift held that time. The till now saves the
// shift it had open with the receipt; the writer binds the payment to it, and
// a shift that closed before the receipt arrived sends it to Held sales.
const state = vi.hoisted(() => ({
  role: "cashier", email: "cashier@example.com", calls: [] as { name: string; args: Record<string, unknown> }[],
  queued: null as Record<string, unknown> | null, outcome: "settled",
  shifts: { taken: null as unknown, open: null as unknown },
}));
vi.mock("@/lib/api-guard", () => ({
  actingStaff: async () => ({ restaurantId: "r", role: state.role, email: state.email }),
  actingManager: async () => ["owner", "manager"].includes(state.role) ? { restaurantId: "r", role: state.role, email: state.email } : null,
}));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number, _: unknown, extra: object = {}) => Response.json({ error, ...extra }, { status }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, planBlocks: async () => null }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ limits: { allows_kitchen_board: true } }) }));
vi.mock("@/lib/offline-comparison", () => ({ compareOfflineSale: async () => null }));
vi.mock("@/lib/offline-pricing", () => ({ currentOfflinePrice: async () => ({ price: { subtotal: 80, serviceFee: 0, tip: 0, discount: 0, total: 80 }, lines: [] }), sameOfflinePrice: () => true, offlineRevenueLines: (saved: unknown[]) => saved }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => {
    const q: Record<string, unknown> = {};
    let open = false;
    for (const key of ["select", "eq", "order", "range"]) q[key] = () => q;
    q.is = () => { open = true; return q; };
    const result = () => ({ error: null, data: table === "restaurants" ? { currency: "MXN" }
      : table === "offline_sale_queue" ? state.queued
      : table === "cash_shifts" ? (open ? state.shifts.open : state.shifts.taken) : null });
    q.single = q.maybeSingle = async () => result();
    return q;
  },
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (name === "offline_pricing_revision_v1") return { data: "rev", error: null };
    state.calls.push({ name, args });
    if (name === "queue_offline_sale") return { data: { queued: true, orderId: args.p_ref, receipt: args.p_body }, error: null };
    if (name === "record_offline_sale_v3" && state.outcome !== "settled") return { data: { outcome: state.outcome }, error: null };
    return { data: { outcome: "settled", settled: true, orderId: args.p_ref, total: 80, method: "cash" }, error: null };
  },
}) }));
const { POST } = await import("@/app/api/pos/order/route");
const recovery = await import("@/app/api/pos/recover/route");

const SHIFT = "5a1f0c2e-0000-4000-8000-00000000000a";
const OPEN = "5a1f0c2e-0000-4000-8000-00000000000b";
const body = (extra: Record<string, unknown> = { cashShiftId: SHIFT }) => ({ posRef: "6b1f0c2e-0000-4000-8000-000000000001", restaurantId: "r", method: "cash", currency: "MXN",
  collectorContext: issueOfflineContext("r", "cashier@example.com", "MXN", Date.now() - 60_000),
  items: [{ itemId: "dish", name: "Dish", price: 80, qty: 1, mods: {} }],
  offline: { at: new Date().toISOString(), subtotal: 80, serviceFee: 0, tip: 0, discount: 0, total: 80 }, ...extra,
});
const request = (data: unknown) => new NextRequest("http://localhost/api/pos/order", { method: "POST", body: JSON.stringify(data) });
const approve = (extra: Record<string, unknown>) => recovery.POST(request({ posRef: body().posRef, restaurantId: "r",
  approval: { confirmed: true, reason: "Receipt checked by hand", ...extra } }));
const sql = readFileSync("supabase/schema.sql", "utf8");
const fn = (name: string): string => sql.split(`create or replace function public.${name}(`).at(-1)!.split("$$;")[0]!;
beforeEach(() => {
  state.calls = []; state.role = "cashier"; state.email = "cashier@example.com"; state.queued = null; state.outcome = "settled";
  state.shifts = { taken: null, open: null }; process.env.SUPABASE_SECRET_KEY = "test-offline-secret";
});

it("a held cash sale carries the till's shift on replay and upload", () => {
  const sale = { posRef: "p", restaurantId: "r", at: "2026-11-25T11:59:00Z", method: "cash", items: [], cashShiftId: SHIFT,
    charge: { subtotal: 80, serviceFee: 0, tip: 0, discount: 0, total: 80 } } as HeldSale;
  expect(replayBody(sale)).toMatchObject({ cashShiftId: SHIFT });
  // An older till's receipt sends none, so the server keeps its device time.
  expect(JSON.parse(JSON.stringify(replayBody({ ...sale, cashShiftId: undefined })))).not.toHaveProperty("cashShiftId");
});

it("sends the till's shift to the writer, which binds the payment to it", async () => {
  const res = await POST(request(body()));
  expect(res.status).toBe(200);
  expect(state.calls).toEqual([expect.objectContaining({ name: "record_offline_sale_v3", args: expect.objectContaining({ p_cash_shift: SHIFT, p_manager: null }) })]);
});

it("a receipt from an older till, or a card sale, keeps today's behaviour: no shift", async () => {
  expect((await POST(request(body({})))).status).toBe(200);
  expect((await POST(request(body({ method: "card", cashShiftId: SHIFT })))).status).toBe(200);
  expect(state.calls.map(c => c.args.p_cash_shift)).toEqual([null, null]);
});

it("a shift that closed before upload queues the sale for Held sales instead of the next shift", async () => {
  for (const outcome of ["shift_closed", "shift_mismatch"]) {
    state.calls = []; state.outcome = outcome;
    const res = await POST(request(body()));
    expect(res.status).toBe(200);
    expect(state.calls.map(c => c.name)).toEqual(["record_offline_sale_v3", "queue_offline_sale"]);
    expect(state.calls[1]!.args).toMatchObject({ p_reason: "apiErr.offlineShiftClosed", p_body: { cashShiftId: SHIFT } });
  }
});

it("a malformed shift is queued for review, never guessed", async () => {
  expect((await POST(request(body({ cashShiftId: "not-a-shift" })))).status).toBe(200);
  expect(state.calls.map(c => c.name)).toEqual(["queue_offline_sale"]);
  expect(state.calls[0]!.args.p_reason).toBe("apiErr.offlineShiftClosed");
});

it("approval of a sale that names a shift needs the shift the manager confirms, and records it there", async () => {
  state.role = "manager"; state.email = "manager@example.com";
  state.queued = { body: body(), collector: "cashier@example.com", currency: "MXN" };
  expect((await approve({})).status).toBe(400);
  expect(state.calls).toEqual([]);
  expect((await approve({ cashShiftId: OPEN })).status).toBe(200);
  expect(state.calls[0]).toMatchObject({ name: "record_offline_sale_v3", args: { p_cash_shift: OPEN, p_manager: "manager@example.com" } });
  // A shift the writer refuses is said so, not queued again.
  state.outcome = "shift_mismatch";
  const refused = await approve({ cashShiftId: SHIFT });
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ error: "apiErr.offlineShiftMismatch" });
});

it("approval of an older receipt ignores a shift and keeps the device time", async () => {
  state.role = "manager";
  state.queued = { body: body({}), collector: "cashier@example.com", currency: "MXN" };
  expect((await approve({ cashShiftId: OPEN })).status).toBe(200);
  expect(state.calls[0]!.args.p_cash_shift).toBeNull();
});

it("Held sales offers the shift the sale was taken in and the open one", async () => {
  state.role = "manager";
  state.queued = { pos_ref: body().posRef, body: body(), collector: "cashier@example.com", currency: "MXN", reason: "apiErr.offlineShiftClosed" };
  state.shifts = { taken: { id: SHIFT, opened_at: "2026-11-25T08:00:00Z", closed_at: "2026-11-25T12:00:00Z" }, open: { id: OPEN, opened_at: "2026-11-25T12:01:00Z", closed_at: null } };
  const res = await recovery.GET(new NextRequest(`http://localhost/api/pos/recover?posRef=${body().posRef}`));
  expect(await res.json()).toMatchObject({ shifts: state.shifts });
  const sale = reviewSale(state.queued as unknown as QueuedOfflineSale, "r");
  expect(sale).toMatchObject({ cashShiftId: SHIFT, error: "apiErr.offlineShiftClosed" });
  for (const locale of ["es", "en"] as const) {
    for (const key of ["apiErr.offlineShiftClosed", "apiErr.offlineShiftMismatch", "recovery.shift", "recovery.shiftTaken", "recovery.shiftOpen", "recovery.shiftHelp", "recovery.shiftNone"]) {
      expect(translate(messagesFor(locale), key)).not.toBe(key);
    }
  }
});

it("intake treats the closed shift as a review reason, not a refusal", () => {
  expect(readFileSync("src/lib/offline-intake.ts", "utf8")).toContain('"apiErr.offlineShiftClosed"]');
});

it("v3 checks the shift under the money lock, keeps v2, and never rebinds a receipt already rung", () => {
  const v3 = fn("record_offline_sale_v3");
  expect(v3).toContain("p_pricing_revision text,\n  p_cash_shift uuid\n");
  expect(v3.indexOf("lock_restaurant_money")).toBeLessThan(v3.indexOf("from cash_shifts"));
  expect(v3).toContain("where restaurant_id = p_restaurant and id = p_cash_shift");
  expect(v3).toContain("s.currency is distinct from p_order->>'currency'");
  expect(v3).toContain("p_at < s.opened_at or p_at > s.closed_at");
  expect(v3).toContain("if p_manager is null and s.closed_at is not null then\n      return jsonb_build_object('outcome', 'shift_closed')");
  expect(v3).toContain("v_new := public.pos_ticket(p_restaurant, p_ref) is null;");
  expect(v3).toContain("if v_new and s.id is not null and v_ticket->>'outcome' = 'settled'");
  expect(v3).toContain("and cash_shift_id is null and currency = s.currency");
  expect(sql).toContain("create or replace function public.record_offline_sale_v2(");
  expect(readFileSync("supabase/drop.sql", "utf8")).toContain("drop function if exists public.record_offline_sale_v3(uuid,uuid,jsonb,text,text,timestamptz,text,jsonb,text,text,text,text,text,uuid);");
});

it("a bound receipt from a fast device clock still counts in its shift, once", () => {
  // Bound rows are counted by when the server wrote them, as the money gate does.
  expect(fn("cash_shift_totals")).toContain("p.cash_shift_id = s.id and coalesce(p.recorded_at, p.created_at) <= p_until");
  const A = { id: "A", restaurant_id: "r", currency: "MXN", opened_at: "2026-11-25T08:00:00Z", closed_at: "2026-11-25T12:00:00Z",
    opening_amount: 100, expected_cash: 180, counted_cash: 180, difference: 0 };
  const B = { id: "B", restaurant_id: "r", currency: "MXN", opened_at: "2026-11-25T12:00:00.500Z", closed_at: "2026-11-25T18:00:00Z",
    opening_amount: 50, expected_cash: 50, counted_cash: 50, difference: 0 };
  // Uploaded at 11:58, dated 12:01 by a clock three minutes fast.
  const fast = { id: "p", restaurant_id: "r", currency: "MXN", method: "cash", actor_email: "cashier", amount: 80,
    created_at: "2026-11-25T12:01:00Z", recorded_at: "2026-11-25T11:58:00Z", cash_shift_id: "A" };
  const rows = { cash_shifts: [A, B], payments: [fast], refund_operations: [], cash_movements: [], held_cash_receipts: [], user_logs: [], orders: [] };
  const bad: string[] = [];
  checkClosedShifts(rows, { ok: () => {}, bad: (m: string) => bad.push(m), info: () => {} });
  expect(bad).toEqual([]);
});
