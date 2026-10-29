import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PRODUCT_ONLY_REASONS, WASTE_REASONS } from "@/lib/costs/usage";

const schema = readFileSync("supabase/schema.sql", "utf8");
const body = (name: string) => schema.split(`create or replace function public.${name}(`).at(-1)!.split("$$;")[0];

it("records a returned plate as a loss without consuming it again (sweep 7, finding 1)", () => {
  expect(WASTE_REASONS).toContain("returned");
  expect(PRODUCT_ONLY_REASONS).toEqual(["returned"]);
  expect(schema).toContain("check (reason in ('spoiled', 'unsold', 'mistake', 'staff', 'returned') and (reason <> 'returned' or item_id is not null))");
  expect(body("track_ingredient_movement")).toContain("elsif v_kind = 'waste' and v_row->>'reason' = 'returned' then v_usage := '{}'::jsonb;");
  for (const writer of ["record_waste", "record_waste_once"]) {
    expect(body(writer), writer).toContain("if v_stock is not null and p_reason <> 'returned' then");
  }
});

it("dates a correction to waste or a purchase with the record it corrects (sweep 7, finding 2)", () => {
  expect(body("track_ingredient_movement")).toContain(
    "case when tg_op = 'INSERT' or v_kind <> 'sale' then (v_row->>'created_at')::timestamptz else clock_timestamp() end");
});

it("holds a recipe's ingredients against an archive while it is saved (sweep 7, finding 7)", () => {
  const save = body("replace_recipe");
  expect(save.indexOf("for share")).toBeGreaterThan(0);
  expect(save.indexOf("for share")).toBeLessThan(save.indexOf("i.archived_at is null"));
});

it("keeps a derived pack price to six places (sweep 7, finding 8)", () => {
  expect(schema).not.toContain("round(p_total / p_packs, 2)");
  expect(schema.match(/round\(p_total \/ p_packs, 6\)/g)?.length).toBe(3);
});

it("takes a wasted plate's ingredients from the choices it was made with (sweep 7, finding 6)", () => {
  expect(schema).toContain("alter table waste_entries add column if not exists choices jsonb;");
  for (const writer of ["record_waste", "record_waste_once"]) expect(body(writer), writer).toContain("case when p_item is not null then p_choices end");
  expect(body("waste_ingredient_usage_v2")).toContain("'mods', coalesce(p_choices->'mods', '{}'), 'extras', coalesce(p_choices->'extras', '[]')");
  expect(body("track_ingredient_movement")).toContain("waste_ingredient_usage_v2(v_restaurant,");
});
