import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const s = vi.hoisted(() => ({ role: "manager" as string | null, foreign: false, error: false, queries: [] as unknown[][] }));
const { resolve, selected } = vi.hoisted(() => ({ resolve: vi.fn(), selected: vi.fn() }));
vi.mock("@/lib/whole-bill-pages", () => ({ resolveCheckoutPages: resolve }));
vi.mock("@/lib/split-page-recovery", () => ({ resolveSelectedSplitPages: selected }));
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => s.role && s.role !== "kitchen" ? { restaurantId: "own", role: s.role } : null }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => {
    const q: Record<string, unknown> = {};
    let start = 0;
    for (const op of ["select", "eq", "in", "is", "not", "order", "range"]) {
      q[op] = (...args: unknown[]) => { s.queries.push([table, op, ...args]); return q; };
    }
    q.range = (from: number) => { start = from; return q; };
    const answer = () => ({ data: s.foreign ? null : { id: "11111111-1111-4111-8111-111111111111", order_ids: ["22222222-2222-4222-8222-222222222222"], account_id: null }, error: s.error ? { message: "failed" } : null });
    q.maybeSingle = async () => answer();
    q.then = (done: (v: unknown) => unknown) => {
      const a = answer(); return Promise.resolve({ ...a, data: a.data && start === 0 ? [a.data] : [] }).then(done);
    };
    return q;
  },
}) }));
const { POST } = await import("@/app/api/checkout/check/route");
const post = (body: unknown) => POST(new NextRequest("https://test/api/checkout/check", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => { vi.clearAllMocks(); s.role = "manager"; s.foreign = false; s.error = false; s.queries = []; resolve.mockResolvedValue("closed"); selected.mockResolvedValue("closed"); });

it.each(["closed", "paid", "unverified", "missing_identity"])("returns the %s outcome without a money writer", async outcome => {
  resolve.mockResolvedValue(outcome);
  expect(await (await post({ kind: "orders", orderIds: [id], restaurantId: "forged" })).json()).toEqual({ outcome });
  expect(resolve).toHaveBeenCalledWith("own", { orderIds: [id] }, true);
  expect(s.queries).toContainEqual(["orders", "eq", "restaurant_id", "own"]);
});
it.each(["owner", "manager", "cashier", "waiter"])("allows %s to check an account without a plan gate", async role => {
  s.role = role;
  expect((await post({ kind: "account", accountId: id })).status).toBe(200);
  expect(resolve).toHaveBeenCalledWith("own", { accountId: id }, true);
});
it.each([null, "kitchen"])("refuses a %s actor before reading any identities", async role => {
  s.role = role; expect((await post({ kind: "account", accountId: id })).status).toBe(403);
  expect(s.queries).toEqual([]); expect(resolve).not.toHaveBeenCalled();
});
it.each([
  { kind: "orders", orderIds: [id, other] }, { kind: "account", accountId: id },
  { kind: "table", tableId: id, currency: "MXN" }, { kind: "split", splitId: id, slots: [1] },
  { kind: "approval", requestKind: "discount", requestId: id },
])("refuses foreign or mixed scopes before contacting Stripe (%j)", async scope => {
  s.foreign = true; expect((await post(scope)).status).toBe(404);
  expect(resolve).not.toHaveBeenCalled(); expect(selected).not.toHaveBeenCalled();
});
it.each(["discount", "writeOff"])("looks up the %s approval's saved orders in its own tenant", async requestKind => {
  expect((await post({ kind: "approval", requestKind, requestId: id })).status).toBe(200);
  expect(resolve).toHaveBeenCalledWith("own", { orderIds: [other] }, true);
  expect(s.queries).toContainEqual([requestKind === "discount" ? "discount_requests" : "write_off_requests", "eq", "restaurant_id", "own"]);
});
it("one visible order cannot authorize a list that also names another tenant's order", async () => {
  expect((await post({ kind: "orders", orderIds: [id, other] })).status).toBe(404);
  expect(resolve).not.toHaveBeenCalled();
});
it("a waiter cannot inspect a manager's approval", async () => {
  s.role = "waiter"; expect((await post({ kind: "approval", requestKind: "writeOff", requestId: id })).status).toBe(403);
  expect(s.queries).toEqual([]);
});
it("a selected-part refusal checks just those parts; a whole-page refusal excludes parts", async () => {
  await post({ kind: "split", splitId: id, slots: [1, 3] });
  expect(selected).toHaveBeenCalledWith("own", id, [1, 3], true); expect(resolve).not.toHaveBeenCalled();
  await post({ kind: "split", splitId: id });
  expect(resolve).toHaveBeenCalledWith("own", { splitId: id, includeParts: false }, true);
});
it("the table check keeps the refused currency and only its collectible debt", async () => {
  await post({ kind: "table", tableId: id, currency: "USD" });
  for (const filter of [["eq", "table_id", id], ["eq", "currency", "USD"], ["eq", "paid", false],
    ["eq", "written_off", false], ["is", "account_id", null], ["not", "status", "in", "(cancelled,pending_payment)"]]) {
    expect(s.queries).toContainEqual(["orders", ...filter]);
  }
});
it.each([{}, { kind: "orders", orderIds: [] }, { kind: "split", splitId: id, slots: [] },
  { kind: "split", splitId: id, slots: [1, 1] }, { kind: "table", tableId: id, currency: "bad" },
  { checkoutIds: [id] }, { kind: "account", accountId: "bad" }])("rejects invalid scope %j", async scope => {
  expect((await post(scope)).status).toBe(400); expect(s.queries).toEqual([]);
});
it("read failures and open pages remain unverified", async () => {
  s.error = true; expect(await (await post({ kind: "orders", orderIds: [id] })).json()).toEqual({ outcome: "unverified" });
  expect(resolve).not.toHaveBeenCalled(); s.error = false; resolve.mockResolvedValue("unresolved");
  expect(await (await post({ kind: "orders", orderIds: [id] })).json()).toEqual({ outcome: "unverified" });
});
