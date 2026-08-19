import { describe, expect, it } from "vitest";
import fs from "node:fs";

/**
 * The reset is the only way back to a clean database, and it fails silently
 * useful ways: a table missing from drop.sql survives with stale rows, and its
 * policies hold the helper functions open so the function drops fail and the
 * reset stops half done. Eight tables had drifted before this test existed.
 */
const schema = fs.readFileSync("supabase/schema.sql", "utf8");
const drop = fs.readFileSync("supabase/drop.sql", "utf8");

function schemaTables(): string[] {
  return [...schema.matchAll(/create table if not exists ([a-z_]+)/g)].map(m => m[1]);
}

function schemaFunctions(): string[] {
  return [...schema.matchAll(/create or replace function public\.([a-z_]+)/g)].map(m => m[1]);
}

describe("drop.sql keeps up with schema.sql", () => {
  it("drops every table the schema creates", () => {
    const missing = [...new Set(schemaTables())].filter(
      t => !new RegExp(`drop table if exists ${t}\\s`).test(drop),
    );
    expect(missing, `not dropped: ${missing.join(", ")}`).toEqual([]);
  });

  it("drops every function the schema creates", () => {
    const missing = [...new Set(schemaFunctions())].filter(
      f => !new RegExp(`drop function if exists public\\.${f}\\(`).test(drop),
    );
    expect(missing, `not dropped: ${missing.join(", ")}`).toEqual([]);
  });

  it("drops every storage policy the schema creates", () => {
    // These sit on storage.objects, outside our tables, so nothing else
    // releases the helper functions they mention.
    const created = [...schema.matchAll(/create policy "([^"]+)" on storage\.objects/g)].map(
      m => m[1],
    );
    expect(created.length).toBeGreaterThan(0);
    const missing = created.filter(
      name => !drop.includes(`drop policy if exists "${name}" on storage.objects`),
    );
    expect(missing, `not dropped: ${missing.join(", ")}`).toEqual([]);
  });

  it("drops the tables before the functions their policies use", () => {
    // A policy mentioning has_role() keeps it alive, so the function drop
    // fails unless its table is already gone.
    expect(drop.indexOf("drop table")).toBeLessThan(drop.indexOf("drop function"));
  });
});
