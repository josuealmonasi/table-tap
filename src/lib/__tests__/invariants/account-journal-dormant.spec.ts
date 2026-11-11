import { expect, it } from "vitest";
import { read, walkAll } from "./helpers";

// PR 2 replaces this blanket boundary with the reviewed writer allow-list.
// Blocking every reference also catches RPC/SQL writers and accidental readers.
const usesJournal = (source: string): boolean => /\baccount_movements\b|\baccount_journal_backfill_v1\b/.test(source);
it("no production source reads, writes or starts the journal in PR 1", () => {
  const files = walkAll("src").filter(file => !file.includes("/__tests__/"));
  expect(files.filter(file => usesJournal(read(file)))).toEqual([]);
});
it("sabotage: catches inserts, updates, deletes, raw SQL and backfill RPC calls", () => {
  for (const source of [
    'db.from("account_movements").insert(row)',
    "db.from('account_movements').update(row)",
    'db.from("account_movements").delete()',
    'sql`insert into public.account_movements values (...)`',
    'db.rpc("account_journal_backfill_v1", params)',
  ]) expect(usesJournal(source)).toBe(true);
  expect(usesJournal('db.from("orders").insert(row)')).toBe(false);
});
