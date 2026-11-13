import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ role: "manager" as string | null }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/membership", () => ({ getMembership: async () => state.role ? { role: state.role, restaurant: { id: "restaurant" } } : null,
  getMember: async () => ({ user: { email: "manager@test" }, membership: state.role ? { role: state.role, restaurant: { id: "restaurant" } } : null }),
  MANAGES: (r: string) => ["owner", "manager"].includes(r) }));
vi.mock("@/lib/current-user", () => ({ currentUser: async () => ({ email: "manager@test" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
import { POST } from "@/app/api/accounts/credit/route";
import { en } from "@/lib/i18n/en";
const body = { orderId: "11111111-1111-4111-8111-111111111111", requestId: "22222222-2222-4222-8222-222222222222",
  amountCents: 100, expectedCents: 500, reason: "error", note: "Mistaken dish" };
const post = (patch = {}) => POST(new NextRequest("https://test/api/accounts/credit", {
  method: "POST", body: JSON.stringify({ ...body, ...patch }) }));
beforeEach(() => { state.role = "manager"; rpc.mockReset().mockResolvedValue({ data: {
  outcome: "credited", adjustmentId: "credit", amountCents: 100, remainingCents: 400, currency: "MXN" }, error: null }); });
it.each([null, "waiter", "cashier", "kitchen"])("refuses %s before any RPC", async role => {
  state.role = role; const r = await post(); expect(r.status).toBe(403);
  expect((await r.json()).error).toBe(en.apiErr.forbidden); expect(rpc).not.toHaveBeenCalled();
});
it.each(["owner", "manager"])("scopes %s's successful credit and returns only the result", async role => {
  state.role = role; const r = await post(); expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ ok: true, adjustmentId: "credit", amountCents: 100, remainingCents: 400, currency: "MXN" });
  expect(rpc).toHaveBeenCalledWith("account_credit_v1", { p_restaurant: "restaurant", p_order: body.orderId,
    p_request: body.requestId, p_actor: "manager@test", p_reason: "error", p_note: body.note, p_amount_cents: 100, p_expected_cents: 500 });
});
it.each([0, -1, 1.5, "100", null, 2147483648])("rejects invalid cents %s", async amountCents => {
  expect((await post({ amountCents })).status).toBe(400); expect(rpc).not.toHaveBeenCalled();
});
it.each([{ expectedCents: 0 }, { expectedCents: 2.5 }, { orderId: "bad" }, { requestId: "bad" },
  { reason: "unknown" }, { note: null }, { reason: "other", note: " " }, { note: "x".repeat(301) }])("validates %j", async patch => {
  expect((await post(patch)).status).toBe(400); expect(rpc).not.toHaveBeenCalled();
});
it.each([
  ["invalid", 400, "accountCreditInvalid"], ["reason", 400, "accountCreditReason"], ["note", 400, "accountCreditNote"],
  ["missing", 404, "notFound"], ["ineligible", 409, "accountCreditIneligible"], ["paying", 409, "accountPayingOnline"],
  ["changed", 409, "accountCreditChanged"], ["capacity", 409, "accountCreditCapacity"],
  ["conflict", 409, "accountCreditConflict"], ["review", 409, "accountCreditReview"], ["unexpected", 500, "generic"],
] as const)("maps %s explicitly", async (outcome, status, key) => {
  rpc.mockResolvedValue({ data: { outcome }, error: null });
  const r = await post(); expect(r.status).toBe(status); expect((await r.json()).error).toBe(en.apiErr[key]);
});
it("fails closed on a database error", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "private database failure" } });
  const r = await post(); expect(r.status).toBe(500); expect((await r.json()).error).toBe(en.apiErr.generic);
});
