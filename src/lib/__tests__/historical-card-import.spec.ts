import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");
const definition = (name: string): string => {
  const start = schema.lastIndexOf(`create or replace function public.${name}(`);
  return schema.slice(start, schema.indexOf("$$;", start) + 3).replace(/\s+/g, " ");
};

describe("historical card return import", () => {
  it("records the reason for a card review and skips only marked reviews", () => {
    const importer = definition("import_historical_return");
    const need = definition("payment_allocations_need_backfill");
    expect(schema).toContain("alter table refund_operations add column if not exists historical_import_reason text;");
    expect(importer).toContain("Historical card return needs provider evidence");
    expect(need).toContain("f.historical_import_reason is null");
    expect(need).toContain("r.id is null");
    expect(importer).toContain("status = 'review'");
  });
});
