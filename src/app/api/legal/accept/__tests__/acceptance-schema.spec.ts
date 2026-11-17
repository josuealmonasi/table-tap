import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync("supabase/schema.sql", "utf8");
it("retains acceptance evidence and archives it before restaurant deletion", () => {
  expect(sql).toContain("create table if not exists terms_acceptances");
  expect(sql).toContain("create trigger terms_acceptances_immutable");
  expect(sql).toContain("'terms_acceptances'");
  expect(sql).toMatch(/create policy "owners read terms acceptances"[\s\S]*?owns_restaurant\(restaurant_id\)/);
});
