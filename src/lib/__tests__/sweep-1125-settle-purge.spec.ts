import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/** Security sweep 2026-11-25 (review of settling and purge). */
const sql = readFileSync("supabase/schema.sql", "utf8");
const fn = (name: string) => sql.slice(sql.indexOf(`create or replace function public.${name}(`)).split(/\n\$\$;|\nend \$\$;|\nend; \$\$;/)[0];

it("a split share's page opens only while the split is locked and its orders unsettled, after the orders are locked", () => {
  const open = fn("diner_checkout_open");
  const lock = open.indexOf("perform 1 from orders where id = any(v_new.order_ids) order by id for update;");
  const guard = open.indexOf("and restaurant_id = v_new.restaurant_id and status = 'locked'");
  expect(lock).toBeGreaterThan(-1);
  expect(guard).toBeGreaterThan(lock);
  expect(open).toContain("if exists (select 1 from orders where id = any(v_new.order_ids) and (paid or written_off)) then");
});

it("a pay-now order still being paid keeps the sitting open, for a checkout page's life only", () => {
  expect(fn("close_session_if_clear")).toContain("and (status <> 'pending_payment' or created_at > now() - interval '35 minutes');");
});

it("a restaurant whose customers still owe on accounts is not deleted, and the admin is told why", () => {
  const del = fn("admin_delete_restaurant");
  expect(del.indexOf("'accountsOwed'")).toBeGreaterThan(-1);
  expect(del.indexOf("'accountsOwed'")).toBeLessThan(del.indexOf("'ready'"));
  expect(readFileSync("src/app/api/admin/restaurants/route.ts", "utf8")).toContain('accountsOwed: "apiErr.restaurantDeleteAccountsOwed"');
});
