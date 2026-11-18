import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync("supabase/schema.sql", "utf8");
const fn = sql.split("create or replace function public.one_trial_per_rfc()")[1]?.split("$$;")[0] ?? "";

it("ends only a free trial whose RFC already had one elsewhere, and records first trials", () => {
  expect(fn).toContain("if new.stripe_subscription_id is not null or new.tier_assignment_id is not null then return new;");
  expect(fn).toContain("exists (select 1 from trial_rfcs where rfc = new.rfc and restaurant_id <> new.id)");
  expect(fn).toContain("new.plan := 'carta'; new.plan_status := 'active'; new.trial_ends_at := null;");
  expect(fn).toMatch(/elsif new\.trial_ends_at is not null then\s+insert into trial_rfcs/);
  expect(sql).toContain("create trigger restaurants_one_trial_per_rfc before update of rfc on restaurants");
  const table = sql.split("create table if not exists trial_rfcs (")[1]?.split("\n);")[0] ?? "";
  expect(table).not.toMatch(/references/i);
  expect(sql).toContain("revoke all on trial_rfcs from anon, authenticated, public, service_role;");
});

it("the terms and the privacy notice say it", () => {
  expect(readFileSync("src/lib/legal/terms-es.json", "utf8")).toContain("por una sola ocasión por restaurante y por RFC");
  expect(readFileSync("src/lib/legal/privacy-es.json", "utf8")).toContain("con el único fin de que la prueba se otorgue una sola vez por RFC");
});
