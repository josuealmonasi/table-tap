import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
const read = (file: string) => readFileSync(file, "utf8");
const schema = read("supabase/schema.sql");
// The production delta is a release artifact, generated from schema.sql and
// checked at release time, not a file in the repo.

it("every diner session producer saves provenance before exposing its URL", () => {
  for (const file of ["src/lib/checkout/card-session.ts", "src/lib/diner-attempt.ts"]) {
    const source = read(file);
    const created = source.indexOf("await stripe.checkout.sessions.create(");
    const saved = source.indexOf("await recordDinerCheckout(");
    const returned = source.indexOf("return session");
    expect(created, file).toBeGreaterThan(-1);
    expect(saved, file).toBeGreaterThan(created);
    expect(returned, file).toBeGreaterThan(saved);
    if (file.includes("diner-attempt")) expect(source).toContain("idempotencyKey: attempt.idempotency_key");
  }
});
it("both webhook mutations pass the signed account/mode into provenance before dispatch", () => {
  const route = read("src/app/api/webhooks/stripe/connect/route.ts");
  expect(route).toContain("settleCheckout(event!.data.object as Stripe.Checkout.Session, event!)");
  expect(route).toContain("abandonCheckout(event!.data.object as Stripe.Checkout.Session, event!)");
  for (const [file, mutation] of [["src/lib/checkout-settle.ts", "await takeFee("],
    ["src/lib/checkout-abandon.ts", "await releaseSessionFee("]]) {
    const source = read(file);
    expect(source.indexOf("await verifyDinerCheckout(session, context)"), file).toBeLessThan(source.indexOf(mutation));
    expect(source.indexOf("await verifyDinerCheckout(session, context)"), file).toBeGreaterThan(-1);
  }
  for (const [file, name, guard] of [
    ["src/lib/card-settle.ts", "settleCardOrders", "requireVerifiedCheckout(session, ids)"],
    ["src/lib/account-checkout.ts", "settleAccountCheckout", "requireVerifiedCheckout(session)"],
    ["src/lib/account-checkout.ts", "abandonAccountCheckout", "requireVerifiedCheckout(session)"],
  ]) {
    const source = read(file);
    const start = source.indexOf(`function ${name}(`);
    expect(start, name).toBeGreaterThan(-1);
    expect(source.slice(start, source.indexOf("\n}", start)), name).toContain(guard);
  }
});
it("the schema preserves frozen pooled receipt currency and scope", () => {
  const start = "create or replace function public.snapshot_payment_scope()";
  const body = (sql: string) => sql.slice(sql.indexOf(start), sql.indexOf("$$;", sql.indexOf(start)) + 3);
  expect(body(schema)).toContain("c.stripe_payment_intent = new.stripe_payment_intent");
  expect(body(schema)).toContain("x = any(c.order_ids)");
  expect(body(schema)).toContain("select c.currency, c.stripe_account_id into new.currency, new.stripe_account_id");
  expect(schema).toContain("restaurants_diner_currency check (currency in ('MXN', 'USD'))");
  expect(schema).toContain("alter table diner_checkouts enable row level security");
  expect(schema).toContain("revoke all on diner_checkouts from anon");
  expect(schema).toContain("revoke all on diner_checkouts from authenticated");
  expect(read("supabase/drop.sql")).toContain("drop table if exists diner_checkouts");
});
