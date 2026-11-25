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
  expect(schema.indexOf("create table if not exists digest_recipients ("))
    .toBeLessThan(schema.indexOf("create or replace view daily_digests_due"));
  expect(due).toContain("or exists (select 1 from digest_recipients x where x.restaurant_id = r.id and x.status = 'confirmed')");
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

const drop = readFileSync("supabase/drop.sql", "utf8");
const statement = (marker: string, end: string) => schema.split(marker)[1]?.split(end)[0];

it("deduplicates current staff and confirmed outside recipients by restaurant and normalized mailbox", () => {
  const address = statement("function public.digest_address_key(", "$$;");
  expect(address).toContain("lower(btrim(p_email))");
  const mailbox = statement("create or replace view daily_digest_mailboxes as", ";");
  expect(mailbox).toContain("from public.daily_digest_recipients");
  expect(mailbox).toContain("s.restaurant_id = d.restaurant_id and s.address_key = public.digest_address_key(d.email)");
  expect(mailbox).toContain("where x.status = 'confirmed'");
  expect(mailbox).toContain("distinct on (restaurant_id, address_key)");
  expect(mailbox).toContain("is_owner desc, user_id nulls last");
});

it("persists the date-specific batch snapshot atomically with the legacy daily claim", () => {
  const claim = statement("function public.claim_daily_digest_v2(", "$$;");
  expect(claim).toMatch(/update public\.restaurants[\s\S]*if not found then return;[\s\S]*insert into public\.daily_digest_batches/);
  expect(claim).toContain("digest_sent_for < p_day");
  expect(claim).toContain("from public.daily_digest_mailboxes where restaurant_id = p_restaurant");
  const retry = statement("create or replace view daily_digests_due_v2", ";");
  expect(retry).toContain("b.digest_day, b.created_at, true");
  expect(retry).toContain("where b.status = 'pending'");
  expect(retry).not.toContain("digest_sent_for");
});

it("stops the same mailbox through either link with restaurant-scoped writes and a staff version check", () => {
  const staff = statement("function public.stop_digest_staff_v2(", "$$;");
  expect(staff).toMatch(/raw_app_meta_data->>'digest_version', '0'\) = p_version for update[\s\S]*insert into public\.digest_staff_stops/);
  expect(staff).toContain("values (p_restaurant, p_address)");
  expect(staff).toContain("where restaurant_id = p_restaurant and public.digest_address_key(email) = p_address");
  const outside = statement("function public.stop_digest_outside_v2(", "$$;");
  expect(outside).toContain("where restaurant_id = v_restaurant");
  expect(outside).toContain("stop_token = p_token and status = 'confirmed' returning public.digest_address_key(email)");
  expect(outside).toContain("values (v_restaurant, v_address)");
});

it("renews the server-owned preference version on opt-in, including through legacy Auth clients", () => {
  const pref = statement("function public.set_digest_preference_v1(", "$$;");
  expect(pref).toContain("raw_app_meta_data = case when p_enabled");
  expect(pref).toContain("jsonb_build_object('digest_version', gen_random_uuid())");
  expect(pref).toContain("delete from public.digest_staff_stops where restaurant_id = p_restaurant and address_key = v_address");
  expect(schema).toContain("create trigger advance_digest_preference_version before update of raw_user_meta_data on auth.users");
});

it("keeps new digest state private and removes its objects on reset", () => {
  for (const table of ["daily_digest_batches", "digest_staff_stops"]) {
    expect(schema).toContain(`alter table ${table} enable row level security;`);
    expect(schema).toContain(`revoke all on ${table} from anon, authenticated, public, service_role;`);
    expect(drop).toContain(`drop table if exists ${table} cascade;`);
  }
  for (const view of ["daily_digest_mailboxes", "daily_digests_due_v2"]) {
    expect(schema).toContain(`revoke all on ${view} from public, anon, authenticated, service_role;`);
    expect(schema).toContain(`grant select on ${view} to service_role;`);
    expect(drop).toContain(`drop view if exists ${view};`);
  }
  for (const fn of ["digest_address_key(text)", "digest_staff_stopped_v1(uuid, uuid)",
    "set_digest_preference_v1(uuid, uuid, boolean)", "stop_digest_staff_v2(uuid, uuid, text, text)",
    "stop_digest_outside_v2(text)", "claim_daily_digest_v2(uuid, date, uuid, text, text, timestamptz, int)"]) {
    expect(schema).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`);
    expect(schema).toContain(`grant execute on function public.${fn} to service_role;`);
    expect(drop).toContain(`drop function if exists public.${fn};`);
  }
});
