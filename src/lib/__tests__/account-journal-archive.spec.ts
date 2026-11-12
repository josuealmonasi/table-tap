import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");
const deletion = schema.split("create or replace function public.admin_delete_restaurant(")[1].split("$$;")[0];

it("archives account journal rows under the tenant money lock before restaurant deletion", () => {
  const tables = deletion.match(/foreach v_table in array array\[([\s\S]*?)\] loop/)?.[1] ?? "";
  // The restaurant cascade removes the original charge snapshots too.
  expect(tables).toContain("'account_movements'");
  const archive = deletion.indexOf("foreach v_table");
  expect(archive).toBeGreaterThan(deletion.indexOf("lock_restaurant_money(p_restaurant)"));
  expect(archive).toBeGreaterThan(deletion.indexOf("if p_check_only"));
  expect(deletion).toContain("from (select * from public.%I where restaurant_id = $1 for update) t");
  expect(deletion.indexOf("delete from restaurants")).toBeGreaterThan(deletion.indexOf("end loop;", archive));
});

it("keeps the held receipt and dispute deletion protections together", () => {
  expect(deletion).toContain("approved_at is null and resolved_at is null");
  for (const table of ["held_cash_receipts", "held_sale_resolutions"]) {
    expect(deletion).toContain(`'${table}'`);
    expect(deletion).toContain(`from ${table} where restaurant_id = p_restaurant for update`);
  }
  expect(deletion).toContain("reconciliation_state <> 'review'");
  for (const table of ["stripe_disputes", "stripe_dispute_movements", "stripe_dispute_events"]) {
    expect(deletion).toContain(`'${table}'`);
  }
});
