import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");
const sql = schema.slice(schema.indexOf("-- S18:"));
const drop = readFileSync("supabase/drop.sql", "utf8");
const fn = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf("$$;", start));
};

describe("S18 ingredient SQL contracts", () => {
  it("freezes sale components, quantities, choices and extras in one snapshot query", () => {
    const snapshot = fn("sale_ingredient_usage");
    for (const key of ["components", "mods", "qty", "extras", "mod_label", "mod_option"]) expect(snapshot).toContain(key);
    expect(snapshot).toContain("r.restaurant_id = p_restaurant");
    expect(snapshot).toContain("-sum(r.quantity * d.quantity)");
    expect(fn("waste_ingredient_usage")).toContain("m->>'type' = 'single'");
    expect(fn("waste_ingredient_usage")).toContain("i.restaurant_id = p_restaurant");
    const writer = fn("track_ingredient_movement");
    expect(writer).toContain("v_usage := v_previous.usage");
    expect(writer).toContain("if v_usage is null or v_changed then");
    expect(writer).toContain("new.items is distinct from old.items");
  });

  it("serializes every source's insert, update and delete, including status changes", () => {
    for (const table of ["orders", "waste_entries", "ingredient_purchases"]) {
      expect(sql).toContain(`after insert or update or delete on ${table} for each row execute function public.track_ingredient_movement()`);
    }
    const writer = fn("track_ingredient_movement");
    expect(writer.indexOf("lock_ingredient_movements")).toBeLessThan(writer.indexOf("insert into ingredient_movements"));
    expect(writer).toContain("'received', 'preparing', 'ready', 'completed'");
    expect(writer).toContain("-value::numeric");
    expect(writer).toContain("having sum(quantity) <> 0");
  });

  it("records the expected figure and serial cutoff inside the count insert, including old callers", () => {
    const count = fn("cutoff_ingredient_count");
    expect(count.indexOf("lock_ingredient_movements")).toBeLessThan(count.indexOf("select * into v_last"));
    expect(count).toContain("nextval('public.ingredient_movements_id_seq')");
    expect(count).toContain("id > v_last.movement_cutoff");
    expect(count).toContain("created_at > v_last.created_at");
    expect(count).toContain("into new.expected");
    expect(sql).toContain("before insert on ingredient_counts");
    const purchase = fn("record_purchase");
    expect(purchase.indexOf("lock_ingredient_movements")).toBeLessThan(purchase.indexOf("for update"));
    const rpc = fn("record_ingredient_counts");
    expect(rpc).toContain("i.restaurant_id = p_restaurant");
    expect(rpc).toContain("i.archived_at is null");
    expect(rpc).toContain("returning ingredient_id, counted, expected");
  });

  it("backfills only new snapshots and leaves existing count boundaries intact", () => {
    expect(sql).toContain("lock table orders, waste_entries, ingredient_purchases, ingredient_counts in share row exclusive mode");
    expect(sql.match(/on conflict do nothing returning \*/g)).toHaveLength(3);
    expect(sql).toContain("add column if not exists movement_cutoff bigint");
    expect(sql).not.toContain("update ingredient_counts");
    expect(sql.trim()).toMatch(/commit;$/);
  });

  it("seeds recipes before orders freeze them, and preserves historical demo count dates", () => {
    const demo = readFileSync("scripts/mock-data.mjs", "utf8");
    const costs = readFileSync("scripts/mock-costs.mjs", "utf8");
    expect(demo.indexOf("await seedCosts(pg, rid)")).toBeLessThan(demo.indexOf('await bulkInsert(pg, "orders"'));
    expect(costs).toContain("movement_cutoff = null");
  });

  it("keeps the new books server-only and resettable without dropping deployed signatures", () => {
    for (const table of ["ingredient_consumption", "ingredient_movements"]) {
      expect(sql).toContain(`alter table ${table} enable row level security`);
      expect(drop).toContain(`drop table if exists ${table} cascade`);
    }
    expect(sql).toContain("revoke all on ingredient_consumption, ingredient_movements from public, authenticated");
    for (const table of ["ingredient_consumption", "ingredient_movements"]) expect(sql).toContain(`revoke all on ${table} from anon`);
    for (const name of ["sale_ingredient_usage", "waste_ingredient_usage", "track_ingredient_movement", "cutoff_ingredient_count", "record_ingredient_counts", "lock_ingredient_movements"]) {
      expect(fn(name)).toContain("set search_path = public");
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^;]+from public, anon, authenticated`));
      expect(drop).toContain(`drop function if exists public.${name}(`);
    }
    expect(sql).not.toContain("drop function");
  });
});
