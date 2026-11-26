import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { walkAll } from "./invariants/helpers";

// Backlog 35 (Codex review), findings 1 and 2: account money bound to what
// the staff member actually reviewed.

const { rpc, insert, page, log } = vi.hoisted(() => ({ rpc: vi.fn(), insert: vi.fn(), page: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => ({ restaurantId: "r1", email: "cashier", role: "manager" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, planBlocks: async () => null }));
vi.mock("@/lib/activity-log", () => ({ logEvent: log }));
vi.mock("@/lib/checkout-page-rpc", () => ({ checkoutPageRpc: page }));
vi.mock("@/lib/ticket-email", () => ({ drainTicketEmails: vi.fn() }));
vi.mock("next/server", async original => ({ ...(await original<typeof import("next/server")>()), after: vi.fn() }));
vi.mock("@/lib/accounts-server", () => ({ accountById: async () => ({ id: "a1", name: "Ana" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from: () => ({ insert: (row: unknown) => {
  insert(row);
  return { select: () => ({ single: async () => ({ data: { id: "new" }, error: null }) }) };
} }) }) }));
const { POST: settle } = await import("@/app/api/accounts/settle/route");
const { POST: openAccount } = await import("@/app/api/accounts/route");
const { chargeRefusal } = await import("@/lib/account-charge");

const ORDER_A = "00000000-0000-4000-8000-00000000000a";
const ORDER_B = "00000000-0000-4000-8000-00000000000b";
const post = (handler: (r: NextRequest) => Promise<Response>, body: object) =>
  handler(new NextRequest("https://test/api", { method: "POST", body: JSON.stringify(body) }));
const collect = (body: object) => post(settle, { accountId: "a1", expected: 100, tip: 0, method: "cash", currency: "MXN", ...body });

const schema = readFileSync("supabase/schema.sql", "utf8");
const drop = readFileSync("supabase/drop.sql", "utf8");
const body = (name: string) => schema.split(`create or replace function public.${name}(`).at(-1)!.split("$$;")[0];
beforeEach(() => vi.clearAllMocks());

describe("finding 1: an in-person account collection is bound to its reference and its orders", () => {
  it.each([[undefined], [""], ["   "]])("refuses a collection with no reference (%j) before the database", async ref => {
    const res = await collect({ ref, orderIds: [ORDER_A] });
    expect(res.status).toBe(400);
    expect(page).not.toHaveBeenCalled();
  });

  it("asks a screen that sends no reviewed orders to refresh, and records nothing", async () => {
    const res = await collect({ ref: "r" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "apiErr.refreshToCollectAccount" });
    expect(page).not.toHaveBeenCalled();
  });

  it.each([[[]], [[ORDER_A, ORDER_A]], [["not-an-id"]], ["x"]])("refuses a reviewed order list that cannot be one (%j)", async orderIds => {
    expect((await collect({ ref: "r", orderIds })).status).toBe(400);
    expect(page).not.toHaveBeenCalled();
  });

  it("sends the reference and the reviewed orders, scoped to the account's own card pages", async () => {
    page.mockResolvedValue({ data: { outcome: "paid", amount: 100, tip: 0 }, error: null });
    expect((await collect({ ref: "review-1", orderIds: [ORDER_A] })).status).toBe(200);
    expect(page).toHaveBeenCalledWith("account_settle_reviewed_v1", expect.objectContaining({
      p_ref: "account:review-1", p_reviewed_orders: [ORDER_A], p_expected: 100, p_currency: "MXN",
    }), { accountId: "a1", currency: "MXN" });
  });

  it("names replacement debt of the same total as its own refusal, and logs nothing", async () => {
    page.mockResolvedValue({ data: { outcome: "orders_changed", owed: 100 }, error: null });
    const res = await collect({ ref: "late", orderIds: [ORDER_B] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "apiErr.accountOrdersChanged" });
    expect(log).not.toHaveBeenCalled();
  });

  it("answers a retry whose first try committed as the same payment", async () => {
    page.mockResolvedValue({ data: { outcome: "duplicate", amount: 100, tip: 0 }, error: null });
    expect(await (await collect({ ref: "same", orderIds: [ORDER_A] })).json()).toMatchObject({ ok: true, duplicate: true });
    expect(log).not.toHaveBeenCalled();
  });

  it("SQL: a blank reference raises, the replay check comes first, and the order set is compared before any money", () => {
    const fn = body("account_settle_reviewed_v1");
    expect(fn).toContain("if p_ref is null or btrim(p_ref) = '' then raise exception");
    expect(fn).toContain("p_reviewed_orders is null or cardinality(p_reviewed_orders) = 0");
    const replay = fn.indexOf("'duplicate'");
    const setCheck = fn.indexOf("'orders_changed'");
    const write = fn.indexOf("insert into payments");
    expect(replay).toBeGreaterThan(0);
    expect(setCheck).toBeGreaterThan(replay);
    expect(write).toBeGreaterThan(setCheck);
    expect(fn).toContain("v_ids <@ p_reviewed_orders and p_reviewed_orders <@ v_ids");
    expect(fn).toContain("cardinality(v_ids) <> cardinality(p_reviewed_orders)");
  });
});

describe("finding 2: a ceiling is stored only in a currency a manager approved", () => {
  it("SQL: the reviewed currency must be the account's debt currency, or the restaurant's when it owes nothing", () => {
    const fn = body("account_set_limit_v1");
    expect(fn).toContain("if p_currency is null");
    const check = fn.indexOf("if p_currency is distinct from v_target then");
    expect(check).toBeGreaterThan(0);
    expect(fn.indexOf("update customer_accounts set credit_limit = p_limit, credit_currency = p_currency")).toBeGreaterThan(check);
    expect(fn).toContain("'mixed_currency'");
  });

  it("SQL: a legacy ceiling with no currency and no charge is refused, not given today's menu currency", () => {
    const unapproved = body("account_limit_unapproved_v1");
    expect(unapproved).toContain("a.credit_currency is null");
    expect(unapproved).not.toMatch(/restaurants/);
    for (const name of ["account_charge_v3", "ring_pos_account_v3"]) {
      const fn = body(name);
      const refusal = fn.indexOf("'limit_unapproved'");
      expect(fn.indexOf("lock_restaurant_money")).toBeLessThan(refusal);
      expect(fn.indexOf("for update")).toBeLessThan(refusal);
      expect(fn.indexOf(`public.${name.replace("v3", "v2")}(`)).toBeGreaterThan(refusal);
    }
  });

  it("the till and the charge route say a manager must confirm the ceiling", async () => {
    const res = await chargeRefusal({ outcome: "limit_unapproved" }, "MXN");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "apiErr.accountLimitUnapproved" });
    expect(readFileSync("src/app/api/pos/order/route.ts", "utf8")).toContain('"limit_unapproved"');
  });

  it("an account opens with the currency its form showed, stored with the ceiling", async () => {
    expect((await post(openAccount, { name: "Ana", limit: 500, currency: "MXN" })).status).toBe(200);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ credit_limit: 500, credit_currency: "MXN" }));
  });

  it("a form from before asks for a refresh, and opens nothing", async () => {
    const res = await post(openAccount, { name: "Ana", limit: 500 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "apiErr.refreshToApproveLimit" });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("the new functions stand beside the deployed ones", () => {
  const added = [
    "account_settle_reviewed_v1(uuid, uuid, numeric, numeric, text, text, text, text, uuid[])",
    "account_set_limit_v1(uuid, uuid, numeric, text, text)",
    "account_limit_unapproved_v1(uuid, uuid)",
    "account_charge_v3(uuid, uuid, uuid[], numeric, text)",
    "ring_pos_account_v3(uuid, uuid, jsonb, uuid, text, text, jsonb, boolean, int)",
  ];
  it.each(added)("%s is granted only to the service role and dropped by drop.sql", signature => {
    expect(schema).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
    expect(schema).toContain(`grant execute on function public.${signature} to service_role;`);
    expect(drop).toContain(`drop function if exists public.${signature}`);
  });
  it("keeps the deployed signatures", () => {
    for (const name of ["account_settle_currency_v1", "account_change_v2", "account_charge_v2", "ring_pos_account_v2"]) {
      expect(schema).toContain(`create or replace function public.${name}(`);
    }
  });
  it("no app code calls the old writers any more", () => {
    const app = walkAll("src").filter(f => /\.tsx?$/.test(f) && !f.includes("__tests__")).map(f => readFileSync(f, "utf8")).join("\n");
    for (const old of ["account_settle_currency_v1", "account_charge_v2", "ring_pos_account_v2"]) expect(app).not.toContain(`"${old}"`);
    expect(app).not.toMatch(/account_change_v2", \{[^}]*p_action: "limit"/);
  });
});
