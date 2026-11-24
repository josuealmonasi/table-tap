import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync("supabase/schema.sql", "utf8");
const drop = readFileSync("supabase/drop.sql", "utf8");
const body = sql.split("create or replace function public.admin_transfer_ownership(")[1]?.split("$$;")[0] ?? "";

it("transfers only to someone on the team, under a row lock, and keeps the former owner as a manager", () => {
  expect(body.indexOf("for update")).toBeGreaterThan(0);
  expect(body.indexOf("for update")).toBeLessThan(body.indexOf("update restaurants set owner_id"));
  // The removal itself is the eligibility check (no EXISTS a concurrent removal can beat).
  expect(body).toContain("delete from staff where restaurant_id = p_restaurant and user_id = p_new_owner returning user_id into v_member");
  expect(body).toMatch(/if v_member is null then return 'not_on_team'/);
  expect(body.indexOf("'owns_another'")).toBeLessThan(body.indexOf("delete from staff"));
  expect(body).toContain("where restaurant_id = p_restaurant and user_id = p_new_owner");
  expect(body).not.toMatch(/on conflict/i);
  expect(body).toMatch(/insert into staff \(restaurant_id, user_id, email, role\) values \(p_restaurant, v_old, [^)]*\), 'manager'\)/);
  expect(sql).toContain("revoke all on function public.admin_transfer_ownership(uuid, uuid) from public, anon, authenticated;");
  expect(sql).toContain("grant execute on function public.admin_transfer_ownership(uuid, uuid) to service_role;");
  expect(drop).toContain("drop function if exists public.admin_transfer_ownership(uuid, uuid);");
  expect(sql).toContain("'restaurant.owner_transfer'");
});
