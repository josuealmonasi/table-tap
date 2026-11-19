import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");

it("names a refund alert in the charge's currency, never today's menu first (sweep 5, finding 1)", () => {
  // Every refund_due alert body. The restaurant's currency is only a last resort.
  const alerts = schema.match(/values \([^;]*'refund_due',[\s\S]*?\);/g) ?? [];
  expect(alerts.length).toBeGreaterThan(3);
  for (const alert of alerts) {
    expect(alert).not.toMatch(/'currency', \(select currency from restaurants/);
  }
  expect(schema.match(/'currency', coalesce\(\s*(?:--[^\n]*\n\s*)*\(select currency from refunds_due where stripe_payment_intent = p_intent\)/g)?.length).toBe(1);
  // The account page's legacy settle used to carry its own copy; it now hands
  // over to account_checkout_settle_v2, which names the alert (journal PR 2).
  const legacy = schema.slice(schema.lastIndexOf("create or replace function public.account_checkout_settle("));
  expect(legacy.slice(0, legacy.indexOf("$$;"))).toContain("return public.account_checkout_settle_v2(p_checkout, p_intent);");
});
