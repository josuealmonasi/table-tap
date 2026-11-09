import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";

vi.mock("@/lib/api-error", () => ({ apiError: async (key: string, status: number, vars?: Record<string, string>) => Response.json({ key, vars }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/checkout-page-rpc", () => ({ checkoutPageRpc: vi.fn() }));
const { chargeRefusal } = await import("@/lib/account-charge");

const schema = readFileSync("supabase/schema.sql", "utf8");
const body = (name: string) => schema.split(`create or replace function public.${name}(`).at(-1)!.split("$$;")[0];

it("refuses a charge in a currency the ceiling was not approved in (sweep 8, finding 2)", () => {
  const charge = body("account_charge_v2");
  expect(charge.indexOf("'limit_currency'")).toBeGreaterThan(0);
  // Before the amount is compared with a number set in another currency.
  expect(charge.indexOf("'limit_currency'")).toBeLessThan(charge.indexOf("if v_owed + v_amount > v_account.credit_limit"));
  expect(charge).toContain("update customer_accounts set credit_currency = v_limit_currency where id = p_account and credit_currency is null;");
  expect(body("account_change_v2")).toContain("credit_limit = p_limit, credit_currency = coalesce(");
  expect(schema).toContain("create trigger stamp_account_credit_currency before insert on customer_accounts");
});

it("says which currency the ceiling needs, from the till's raw answer too", async () => {
  const res = await chargeRefusal({ outcome: "limit_currency", limit: 500, limit_currency: "MXN", currency: "USD" } as never, "USD");
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ key: "apiErr.accountLimitCurrency", vars: { currency: "USD" } });
});
