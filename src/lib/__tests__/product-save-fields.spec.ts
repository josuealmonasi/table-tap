import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// A dish is saved by the products route and, with its extras, by
// save_product_addons_v1 in SQL. Two places must agree on what may change:
// a field the route sends and the SQL refuses fails every save of that dish;
// one the SQL allows and the route does not filter is written unchecked.
it("the products route and save_product_addons_v1 accept the same fields", () => {
  const route = readFileSync("src/app/api/products/route.ts", "utf8");
  const routeFields = /const FIELDS = new Set\(\[([^\]]*)\]\)/.exec(route)?.[1].match(/"([a-z_]+)"/g)?.map(f => f.replaceAll('"', "")) ?? [];
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const start = schema.lastIndexOf("create or replace function public.save_product_addons_v1(");
  const fn = schema.slice(start, schema.indexOf("$$;", schema.indexOf("$$", start) + 2));
  const sqlFields = /where key not in \(([^)]*)\)/.exec(fn)?.[1].match(/'([a-z_]+)'/g)?.map(f => f.replaceAll("'", "")) ?? [];
  expect(routeFields.length).toBeGreaterThan(5);
  expect([...sqlFields].sort()).toEqual([...routeFields].sort());
});
