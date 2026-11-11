import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
const state = vi.hoisted(() => ({ actor: { restaurantId: "11111111-1111-4111-8111-111111111111", email: "manager@test.dev" } as object | null,
  rpc: vi.fn(), open: vi.fn(), withdrawals: vi.fn() }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => state.actor }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: state.rpc }) }));
vi.mock("@/lib/cash-shift-server", () => ({ openShift: state.open, shiftWithdrawals: state.withdrawals }));
import { POST, GET } from "@/app/api/pos/recover/resolve/route";
const id = "22222222-2222-4222-8222-222222222222";
const body = { restaurantId: "11111111-1111-4111-8111-111111111111", posRef: id, reason: "Nothing was collected", disposition: "no_cash",
  collector: "cashier@test.dev", amount: 0, currency: "MXN", collectedAt: "2026-11-10T12:00:00.000Z" };
const post = (value: unknown) => POST(new NextRequest("http://localhost/api/pos/recover/resolve", { method: "POST", body: JSON.stringify(value) }));
beforeEach(() => {
  state.actor = { restaurantId: body.restaurantId, email: "manager@test.dev" }; state.rpc.mockReset(); state.open.mockReset(); state.withdrawals.mockReset();
  state.rpc.mockResolvedValue({ data: { ...body, resolved_at: "2026-11-11T12:00:00Z" }, error: null });
});
it.each([
  ["short reason", { reason: "short" }], ["blank reason", { reason: "        " }], ["long reason", { reason: "x".repeat(501) }],
  ["reason type", { reason: 12345678 }], ["disposition", { disposition: "approve" }], ["string amount", { amount: "0" }],
  ["negative amount", { amount: -1 }], ["subcent amount", { amount: 1.001 }], ["excess amount", { amount: 1_000_000.01 }],
  ["null amount", { amount: null }], ["currency", { currency: "EUR" }], ["date", { collectedAt: "bad" }],
  ["non ISO date", { collectedAt: "11/10/2026" }], ["date without timezone", { collectedAt: "2026-11-10T12:00:00" }],
  ["date type", { collectedAt: 1 }], ["payment uuid", { paymentId: "bad" }], ["receipt uuid", { cashReceiptId: "bad" }],
  ["impossible ISO day", { collectedAt: "2026-02-30T12:00:00Z" }],
  ["payout uuid", { payoutId: "bad" }], ["null link", { paymentId: null }], ["reference uuid", { posRef: "bad" }],
  ["restaurant uuid", { restaurantId: "bad" }], ["collector", { collector: "  " }], ["collector type", { collector: 1 }],
  ["long collector", { collector: "x".repeat(255) }], ["body actor", { actor: "owner@test.dev" }],
])("rejects %s before RPC", async (_name, patch) => {
  const res = await post({ ...body, ...patch });
  expect({ status: res.status, data: await res.json(), calls: state.rpc.mock.calls.length }).toEqual({ status: 400, data: { error: "apiErr.heldResolveInvalid" }, calls: 0 });
});
it("rejects a different restaurant before RPC", async () => {
  const res = await post({ ...body, restaurantId: id });
  expect({ status: res.status, calls: state.rpc.mock.calls.length }).toEqual({ status: 400, calls: 0 });
});
it.each([null, [], "bad"])("refuses non-object %j", async value => {
  expect((await post(value)).status).toBe(400);
});
it("refuses a waiter before reading or writing money", async () => {
  state.actor = null;
  expect({ post: (await post(body)).status, get: (await GET()).status, calls: state.rpc.mock.calls.length + state.open.mock.calls.length }).toEqual({ post: 403, get: 403, calls: 0 });
});
it("passes the session actor and cent-precise details to the RPC", async () => {
  await post({ ...body, amount: 0.29, disposition: "duplicate", paymentId: id, reason: "  Verified duplicate  " });
  expect(state.rpc.mock.calls).toEqual([["resolve_held_sale", { p_restaurant: body.restaurantId, p_ref: id, p_actor: "manager@test.dev",
    p_reason: "Verified duplicate", p_disposition: "duplicate", p_collector: body.collector, p_amount: 0.29,
    p_currency: "MXN", p_collected_at: body.collectedAt, p_payment: id, p_cash_receipt: null, p_payout: null }]]);
});
it("forwards receipt and withdrawal links", async () => {
  await post({ ...body, cashReceiptId: id, payoutId: id });
  expect(state.rpc.mock.calls[0][1]).toMatchObject({ p_cash_receipt: id, p_payout: id });
});
it("returns the immutable RPC record unchanged on both calls", async () => {
  const first = await post(body), second = await post(body);
  expect({ first: first.status, second: second.status, a: await first.json(), b: await second.json(), calls: state.rpc.mock.calls.length })
    .toEqual({ first: 200, second: 200, a: { ...body, resolved_at: "2026-11-11T12:00:00Z" }, b: { ...body, resolved_at: "2026-11-11T12:00:00Z" }, calls: 2 });
});
const errors = [
  ["manager required", "heldResolveManager", 403], ["invalid resolution", "heldResolveInvalid", 400],
  ["held cash receipt required", "heldResolveCashRequired", 400], ["receipt already resolved", "heldResolveResolved", 409],
  ["receipt already decided", "heldResolveDecided", 409], ["collected currency changed", "heldResolveCurrency", 409],
  ["collector changed", "heldResolveCollector", 409], ["existing accounting requires duplicate resolution", "heldResolveExisting", 409],
  ["one duplicate link required", "heldResolveOneLink", 400], ["matching cash payment required", "heldResolvePayment", 400],
  ["matching cash receipt required", "heldResolveReceipt", 400], ["open shift required", "heldResolveOpenShift", 409],
  ["matching recorded payout required", "heldResolvePayout", 400],
  ["foreign returned cash takes no payout", "heldResolveForeignPayout", 400], ["unexpected payout", "heldResolveUnexpectedPayout", 400],
  ["no_cash takes no amount and no links", "heldResolveNoCash", 400], ["unexpected receipt link", "heldResolveUnexpectedReceipt", 400],
  ["new cash receipt required", "heldResolveNewCash", 400], ["unique", "heldResolveLinkUsed", 409], ["conflict", "heldResolveDecided", 409],
] as const;
it.each(errors)("maps SQL %s with bilingual copy", async (message, key, status) => {
  state.rpc.mockResolvedValue({ data: null, error: { message, code: message === "unique" ? "23505" : message === "conflict" || message.startsWith("receipt already") ? "PT409" : "P0001" } });
  const res = await post(body);
  expect({ status: res.status, data: await res.json(), en: Boolean(en.apiErr[key]), es: Boolean(es.apiErr[key]) })
    .toEqual({ status, data: { error: `apiErr.${key}` }, en: true, es: true });
});
it.each([{ data: null, error: { message: "network" } }, { data: null, error: null }])("fails closed on unavailable RPC %j", async result => {
  state.rpc.mockResolvedValue(result);
  expect((await post(body)).status).toBe(503);
});
it("returns only the acting restaurant's open-shift withdrawals", async () => {
  state.open.mockResolvedValue({ id, currency: "USD" }); state.withdrawals.mockResolvedValue([{ id: "payout", amount: 12 }]);
  const res = await GET();
  expect({ status: res.status, body: await res.json(), open: state.open.mock.calls, withdrawals: state.withdrawals.mock.calls }).toEqual({
    status: 200, body: { restaurantId: body.restaurantId, shiftId: id, shiftCurrency: "USD", withdrawals: [{ id: "payout", amount: 12 }] },
    open: [[body.restaurantId]], withdrawals: [[body.restaurantId, id]],
  });
});
it("offers no withdrawals without an open shift", async () => {
  state.open.mockResolvedValue(null);
  expect({ body: await (await GET()).json(), calls: state.withdrawals.mock.calls.length }).toEqual({ body: { restaurantId: body.restaurantId, shiftId: null, shiftCurrency: null, withdrawals: [] }, calls: 0 });
});
it("reports withdrawal read failures", async () => {
  state.open.mockRejectedValue(new Error("offline"));
  expect((await GET()).status).toBe(503);
});
