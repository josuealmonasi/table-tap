import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/** Security sweep 2026-11-24: what the public and signed-in roles may reach directly. */
const sql = readFileSync("supabase/schema.sql", "utf8");

it("staff may only mark a notification read: table-level writes are revoked before the column grant", () => {
  const revoke = sql.indexOf("revoke insert, update, delete, truncate, references, trigger on notifications from authenticated;");
  expect(revoke).toBeGreaterThan(-1);
  expect(revoke).toBeLessThan(sql.indexOf("grant update (read_at) on notifications to authenticated;"));
});

it("nobody lists the menu bucket; photos are served by public URL", () => {
  expect(sql).toContain(`drop policy if exists "menu images are public to read" on storage.objects;`);
  expect(sql).not.toMatch(/create policy "menu images are public to read"/);
});

it("add-on and promotion links are public only through a visible parent", () => {
  expect(sql).toContain(`on item_addons for select using (exists (select 1 from menu_items mi where mi.id = product_id));`);
  expect(sql).toContain(`on promotion_items for select using (exists (select 1 from promotions p where p.id = promotion_id));`);
  expect(sql).not.toMatch(/on (item_addons|promotion_items) for select using \(true\)/);
});

it("diners see rating averages only for dishes they can see", () => {
  const fn = sql.slice(sql.indexOf("function public.dish_rating_stats")).split("$$;")[0];
  expect(fn).toContain("auth.role() = 'service_role' or exists (");
  expect(fn).toContain("mi.available and m.active");
});
