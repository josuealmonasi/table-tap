import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("reuses the payment tenant key for held receipts without building it twice", () => {
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const indexes = [...schema.matchAll(
    /create unique index if not exists (\w+) on payments\(restaurant_id, id\);/g,
  )].map(match => match[1]);
  expect(indexes).toEqual(["payments_tenant_identity"]);
  // No drop either: a dev database that built the draft index may have the
  // held-receipt foreign key resting on it, and a plain drop would refuse.
  expect(schema).not.toMatch(/\bpayments_tenant_id\b/);
});
