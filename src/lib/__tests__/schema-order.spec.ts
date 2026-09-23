import { describe, expect, it } from "vitest";
import fs from "node:fs";

/**
 * `schema.sql` has to build an empty database, top to bottom.
 *
 * Run against a database that already has everything, a statement about a
 * table or function that is only created further down succeeds — the thing it
 * names already exists from last time. Run against nothing, the whole script
 * fails on it. Two did exactly that for two weeks: a revoke on `plan_limits`
 * four hundred lines above the table, and a revoke on `enforce_plan_limit()`
 * above the function. Nothing noticed until a reset dropped every table and
 * then could not build them again.
 *
 * `drop … if exists` is allowed anywhere: it is written for the case where
 * the thing is not there.
 */
const code = fs.readFileSync("supabase/schema.sql", "utf8").replace(/--[^\n]*/g, "");
const lineOf = (at: number) => code.slice(0, at).split("\n").length;

function firstAt(pattern: RegExp): number {
  const m = pattern.exec(code);
  return m ? m.index : -1;
}

describe("the schema builds from nothing", () => {
  it("creates every table before anything names it", () => {
    const tables = [...new Set([...code.matchAll(/create table if not exists ([a-z_]+)/g)].map(m => m[1]))];
    const early: string[] = [];
    for (const t of tables) {
      const born = firstAt(new RegExp(`create table if not exists ${t}\\b`));
      const uses = new RegExp(
        `(?:alter table|(?:grant|revoke)[^;]*?\\son|create policy[^;]*?\\son|create (?:unique )?index[^;]*?\\son|create trigger[^;]*?\\son)\\s+(?:public\\.)?${t}\\b`,
        "gi",
      );
      for (const m of code.matchAll(uses)) {
        if (m.index! < born) early.push(`line ${lineOf(m.index!)}: ${t} — "${m[0].slice(0, 50)}…"`);
      }
    }
    expect(early, `named before it is created:\n${early.join("\n")}`).toEqual([]);
  });

  it("defines every function before a trigger or grant names it", () => {
    const fns = [...new Set([...code.matchAll(/create or replace function public\.([a-z_]+)/g)].map(m => m[1]))];
    const early: string[] = [];
    for (const f of fns) {
      const born = firstAt(new RegExp(`create or replace function public\\.${f}\\b`));
      const uses = new RegExp(`(?:execute function|(?:grant|revoke)[^;]*?\\son function)\\s+public\\.${f}\\b`, "gi");
      for (const m of code.matchAll(uses)) {
        if (m.index! < born) early.push(`line ${lineOf(m.index!)}: ${f}()`);
      }
    }
    expect(early, `named before it is defined:\n${early.join("\n")}`).toEqual([]);
  });
});
