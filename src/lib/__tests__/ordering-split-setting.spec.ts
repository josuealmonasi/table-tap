import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
it("N5: the locked split writer refuses new splits when the owner disables them", () => {
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const start = schema.lastIndexOf("create or replace function public.start_bill_split_v2(");
  const body = schema.slice(start, schema.indexOf("$$;", start));
  const disabled = body.indexOf("not split_enabled");
  expect(disabled).toBeGreaterThan(body.indexOf("'outcome', 'repeat'"));
  expect(disabled).toBeGreaterThan(body.indexOf("public.lock_restaurant_money("));
  expect(disabled).toBeLessThan(body.indexOf("insert into bill_splits"));
});
