import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync("supabase/schema.sql", "utf8");
it("retains acceptance evidence and archives it before restaurant deletion", () => {
  expect(sql).toContain("create table if not exists terms_acceptances");
  expect(sql).toContain("create trigger terms_acceptances_immutable");
  expect(sql).toContain("'terms_acceptances'");
  expect(sql).toContain("grant select on terms_acceptances to service_role;");
  expect(sql).not.toContain("grant select on terms_acceptances to authenticated");
});

it("keeps only the approved evidence and identifies its source", () => {
  const table = sql.slice(sql.indexOf("create table if not exists terms_acceptances"), sql.indexOf("alter table terms_acceptances enable"));
  expect(table).not.toMatch(/\b(ip|user_agent)\s+text/);
  expect(table).toMatch(/source[\s\S]*'accept'[\s\S]*'signup'[\s\S]*'backfill'[\s\S]*'legacy_trigger'/);
  expect(table).toMatch(/char_length\(accepted_email\)/);
  expect(table).toMatch(/char_length\(version\)/);
  expect(table).toMatch(/char_length\(text_hash\)/);
});
it("ignores unchanged legacy values", () => {
  expect(sql).toMatch(/old\.terms_version is distinct from new\.terms_version/);
  expect(sql).toMatch(/old\.terms_accepted_at is distinct from new\.terms_accepted_at/);
  expect(sql).toMatch(/old\.terms_accepted_email is distinct from new\.terms_accepted_email/);
});
it("authorizes and serializes acceptance before deduplicating it", () => {
  const fn = sql.slice(sql.indexOf("create or replace function public.accept_terms_v1"), sql.indexOf("revoke all on function public.accept_terms_v1"));
  expect(fn).toMatch(/owner_id = p_user/);
  expect(fn).toMatch(/s\.user_id = p_user and s\.role = 'owner'/);
  expect(fn).toMatch(/for update/);
  expect(fn).toMatch(/user_id = p_user[\s\S]*version = left\(p_version, 100\)[\s\S]*text_hash = left\(p_text_hash, 64\)[\s\S]*interval '1 minute'/);
});

it("preserves earlier rows when adding their source", () => {
  expect(sql).toMatch(/when legacy then 'backfill' else 'legacy_trigger' end/);
  expect(sql).toMatch(/alter table terms_acceptances alter column source set not null/);
  expect(sql).toMatch(/add constraint terms_acceptances_source_allowed/);
  expect(sql).toMatch(/add constraint terms_acceptances_text_lengths/);
});
