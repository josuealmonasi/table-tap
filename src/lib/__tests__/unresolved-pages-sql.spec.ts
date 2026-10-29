import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");
const latest = (name: string): string =>
  [...schema.matchAll(/create or replace function public\.([a-z_0-9]+)\([\s\S]*?\$\$;/g)].filter(m => m[1] === name).at(-1)?.[0] ?? "";

describe("an unresolved card page blocks every collection and movement of its debt, at any age", () => {
  it("no writer decides by a 35-minute window or a hold deadline any more", () => {
    // checkout_until may still be written as information; it never authorizes.
    expect(schema).not.toMatch(/card_checkout_at\s*>\s*now\(\)\s*-\s*interval '35 minutes'/);
    expect(schema).not.toMatch(/card_checkout_at\s*<=\s*now\(\)\s*-\s*interval '35 minutes'/);
    expect(schema).not.toMatch(/checkout_until\s*>\s*now\(\)/);
  });
  it("whole-bill pages block collection, transfer and settling", () => {
    for (const fn of ["account_charge", "account_charge_v2", "collect_table_reviewed_v1", "collect_on_sitting_v2",
      "collect_on_sittings_v1", "settle_orders_v2", "start_bill_split_v2", "reserve_split_slots_v1", "collect_split_slots_v1"]) {
      expect(latest(fn), fn).toContain("public.whole_bill_card_open_v1(p_restaurant,");
    }
    // The batch checks every sitting before it writes any.
    const batch = latest("collect_on_sittings_v1");
    expect(batch.indexOf("whole_bill_card_open_v1")).toBeLessThan(batch.indexOf("public.collect_on_sitting_v2(p_restaurant"));
  });
  it("account pages block account collection, a new account page and cancellation", () => {
    for (const fn of ["account_settle", "account_settle_v2", "account_settle_currency_v1",
      "account_checkout_open", "account_checkout_open_v2", "account_checkout_currency_v1", "cancel_order", "cancel_order_v2"]) {
      expect(latest(fn), fn).toContain("public.unresolved_account_page_v1(p_restaurant,");
    }
    for (const fn of ["account_checkout_open", "account_checkout_open_v2", "account_checkout_currency_v1"]) {
      expect(latest(fn), fn).not.toContain("update account_checkouts set status = 'expired' where account_id = p_account and status = 'open'");
    }
  });
  it("an account page that never reached Stripe is released atomically, and cannot get a page afterwards", () => {
    const release = latest("release_unreached_account_page_v1");
    expect(release.indexOf("public.lock_restaurant_money(p_restaurant)")).toBeGreaterThan(0);
    expect(release).toContain("a.created_at > now() - interval '10 minutes'");
    expect(release).toContain("c.metadata->>'account_checkout' = a.id::text");
    // The same lock guards opening its diner page: a released checkout gets none.
    expect(latest("diner_checkout_open")).toContain("raise exception 'checkout_unavailable'");
  });
  it("repricing skips any order an open page was priced from", () => {
    expect(latest("reprice_open_service")).toContain("c.status = 'open' and o.id = any(c.order_ids)");
  });
});
