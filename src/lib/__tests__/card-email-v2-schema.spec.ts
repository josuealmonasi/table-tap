import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/** Card email (security sweep bl22, reviewed 2026-11-25). */
const sql = readFileSync("supabase/schema.sql", "utf8");
const v2 = sql.slice(sql.indexOf("create or replace function public.set_card_email_v2(")).split("\n$$;")[0];

it("keeps the previous writer while deployed code may still call it", () => {
  expect(sql).toContain("create or replace function public.set_card_email(p_restaurant uuid, p_code text, p_email text, p_set_by text, p_notice text)");
  expect(sql).not.toMatch(/^drop function if exists public\.set_card_email\(uuid, text, text, text, text\);/m);
});

it("staff saves are trusted as typed and logged; only the guest's own change waits for the inbox", () => {
  const staff = v2.indexOf("elsif p_actor is not null then");
  const pending = v2.indexOf("pending_email = p_email, pending_email_token_hash = p_token_hash");
  expect(staff).toBeGreaterThan(-1);
  expect(staff).toBeLessThan(pending);
  expect(v2).toContain("if p_owner_hash is null or card.owner_secret_hash is distinct from p_owner_hash then return 'forbidden'; end if;");
  expect(v2).toContain("insert into public.user_logs");
});
