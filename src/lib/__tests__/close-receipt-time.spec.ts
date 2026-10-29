import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");

describe("a receipt is recorded when it is written (sweep 1, finding 3)", () => {
  it("defaults recorded_at to the insert moment, as the close stamps its cutoff", () => {
    expect(schema).toContain("alter table payments alter column recorded_at set default clock_timestamp();");
    expect(schema).not.toContain("alter table payments alter column recorded_at set default now();");
    // The close's cutoff is taken after the money lock, with the same clock.
    const close = schema.slice(schema.indexOf("update cash_shifts set closed_at = v_at") - 1200, schema.indexOf("update cash_shifts set closed_at = v_at"));
    expect(close).toContain("v_at := clock_timestamp();");
  });
});
