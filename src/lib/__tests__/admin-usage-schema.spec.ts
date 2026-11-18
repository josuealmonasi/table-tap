import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("limits restaurant sign-in evidence to the service role and the selected team", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8");
  const drop = readFileSync("supabase/drop.sql", "utf8");
  const body = sql.split("create or replace function public.admin_restaurant_last_sign_in_v1(")[1]?.split("$$;")[0] ?? "";
  expect(body).toContain("security definer set search_path = public");
  expect(body).toContain("restaurant_id = p_restaurant");
  expect(body).toContain("id = p_restaurant");
  expect(sql).toContain("revoke all on function public.admin_restaurant_last_sign_in_v1(uuid) from public, anon, authenticated;");
  expect(sql).toContain("grant execute on function public.admin_restaurant_last_sign_in_v1(uuid) to service_role;");
  expect(drop).toContain("drop function if exists public.admin_restaurant_last_sign_in_v1(uuid);");
});
