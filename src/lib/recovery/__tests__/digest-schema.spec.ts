import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");

it("limits digest discovery and confirmed recipient addresses to service-role reads", () => {
  const recipients = schema.split("create or replace view daily_digest_recipients as")[1]?.split(";")[0];
  expect(recipients).toContain("s.role in ('owner', 'manager') and s.user_id is distinct from r.owner_id");
  expect(recipients).toContain("u.email_confirmed_at is not null");
  expect(recipients).toContain("u.raw_user_meta_data->'digest' is distinct from 'false'::jsonb");
  expect(recipients).toContain("u.raw_user_meta_data->'digest' = 'true'::jsonb");
  for (const reader of ["daily_digest_recipients", "daily_digests_due", "menu_stockouts"]) {
    expect(schema).toContain(`revoke all on ${reader} from anon, authenticated, public, service_role;`);
    expect(schema).toContain(`grant select on ${reader} to service_role;`);
  }
});

it("discovers work at local 07:00 and matches only paid orders inside the completed local day", () => {
  const due = schema.split("create or replace view daily_digests_due")[1]?.split(";")[0];
  expect(due).toContain("now() at time zone r.timezone");
  expect(due).toContain("clock.local_now::time >= time '07:00'");
  expect(due).toContain("r.digest_sent_for < clock.local_now::date - 1");
  expect(due).toContain("o.paid and o.status <> 'cancelled'");
  expect(due).toContain("o.created_at >= ((clock.local_now::date - 1)::timestamp at time zone r.timezone)");
  expect(due).toContain("o.created_at < (clock.local_now::date::timestamp at time zone r.timezone)");
});

it("records positive-to-zero stock changes even when dashboard notifications are disabled", () => {
  const trigger = schema.split("create or replace function public.record_menu_stockout()")[1]?.split("$$;")[0];
  expect(trigger).toContain("insert into public.menu_stockouts");
  expect(trigger).not.toContain("low_stock_alerts_enabled");
  expect(schema).toContain("for each row when (old.stock > 0 and new.stock = 0)");
});
