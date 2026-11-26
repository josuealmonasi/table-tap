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

// Admin recheck: the former owner's confirmed digest addresses kept receiving
// the restaurant's daily sales after a transfer. v2 clears them; v1 stays.
const v2 = sql.split("create or replace function public.admin_transfer_ownership_v2(")[1]?.split("$$;")[0] ?? "";

it("v2 clears the restaurant's digest recipients in the same transaction, and the route calls v2", () => {
  expect(v2).toContain("delete from digest_recipients where restaurant_id = p_restaurant;");
  expect(v2.indexOf("for update")).toBeLessThan(v2.indexOf("delete from digest_recipients"));
  // Only once the transfer itself happened; a refusal keeps every address.
  expect(v2.indexOf("'not_on_team'")).toBeLessThan(v2.indexOf("delete from digest_recipients"));
  expect(v2.indexOf("update restaurants set owner_id")).toBeLessThan(v2.indexOf("delete from digest_recipients"));
  // Everything v1 guarantees, v2 still does.
  for (const piece of ["delete from staff where restaurant_id = p_restaurant and user_id = p_new_owner returning user_id into v_member",
    "'owns_another'", "'already_owner'", "'manager')"]) expect(v2).toContain(piece);
  expect(body).not.toContain("digest_recipients");
  expect(sql).toContain("revoke all on function public.admin_transfer_ownership_v2(uuid, uuid) from public, anon, authenticated;");
  expect(sql).toContain("grant execute on function public.admin_transfer_ownership_v2(uuid, uuid) to service_role;");
  expect(drop).toContain("drop function if exists public.admin_transfer_ownership_v2(uuid, uuid);");
  // Defined after the table it deletes from.
  expect(sql.indexOf("create table if not exists digest_recipients")).toBeLessThan(sql.indexOf("function public.admin_transfer_ownership_v2("));
  const route = readFileSync("src/app/api/admin/restaurants/owner/route.ts", "utf8");
  expect(route).toContain('rpc("admin_transfer_ownership_v2"');
});
