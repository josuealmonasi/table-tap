-- ============================================================================
-- TableTap — Database Schema
-- Run this in Supabase: Dashboard → SQL Editor → paste → Run
-- ============================================================================

-- ── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ── Restaurants ─────────────────────────────────────────────────────────────
create table if not exists restaurants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  tagline     text,
  logo        text default '🍱',
  currency    text not null default 'MXN',
  service_pct numeric not null default 0,        -- service charge %, e.g. 10
  service_enabled boolean not null default false, -- charge the service % only when on
  accepting_orders boolean not null default true, -- kill switch: pause customer orders
  tax_pct numeric not null default 0,             -- IVA %, already INCLUDED in prices
  tax_show_breakdown boolean not null default false, -- show net + IVA split to customers
  -- Stripe Connect: the restaurant's own connected account, so customer
  -- payments land in THEIR balance (not the platform's). Server-only — never
  -- granted to anon.
  stripe_account_id text,                          -- Stripe Express account (acct_…)
  stripe_charges_enabled boolean not null default false, -- onboarding complete, can accept charges
  owner_id    uuid references auth.users(id),    -- the dashboard account
  created_at  timestamptz not null default now()
);

-- ── Tables (physical tables in the restaurant) ──────────────────────────────
create table if not exists restaurant_tables (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  label         text not null,                   -- "7", "Patio 3", etc
  created_at    timestamptz not null default now()
);

-- ── Menus ───────────────────────────────────────────────────────────────────
-- A restaurant can run several named menus (e.g. "Breakfast", "Dinner") and
-- turn them on/off through the day. Each menu owns its own categories, products
-- and extras — nothing is shared between menus. Orders and tables/QRs are NOT
-- tied to a menu; they stay shared across the whole restaurant.
create table if not exists menus (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name          text not null,
  active        boolean not null default true,   -- shown to customers when true
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

-- Menu names are unique within a restaurant (case-insensitive, trimmed). Also
-- keeps the /dashboard/{menu-name} URL unambiguous.
create unique index if not exists menus_restaurant_name_unique
  on menus (restaurant_id, lower(btrim(name)));

-- ── Menu categories ─────────────────────────────────────────────────────────
create table if not exists categories (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  menu_id       uuid references menus(id) on delete cascade,
  name          text not null,
  sort_order    int not null default 0
);

-- ── Menu items ──────────────────────────────────────────────────────────────
create table if not exists menu_items (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  menu_id       uuid references menus(id) on delete cascade,
  category_id   uuid references categories(id) on delete set null,
  name          text not null,
  description   text,
  price         numeric not null default 0,
  emoji         text default '🍽️',
  image_url     text,
  popular       boolean not null default false,
  available     boolean not null default true,
  -- an add-on item (e.g. Catsup) is a menu_item that's attached to products
  -- rather than shown standalone on the menu. See item_addons below.
  is_addon      boolean not null default false,
  -- modifiers stored as JSON: [{ label, type: 'single'|'multi', options: [string] }]
  modifiers     jsonb not null default '[]'::jsonb,
  -- dietary / allergen tag keys (see src/lib/dietary.ts)
  dietary       text[] not null default '{}',
  -- % off this item's base price (0 = no discount). The customer menu shows the
  -- original struck through next to the sale price. Extras are never discounted.
  discount_pct  numeric not null default 0,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

-- ── Orders ──────────────────────────────────────────────────────────────────
-- status: 'pending_payment' | 'received' | 'preparing' | 'ready' | 'completed' | 'cancelled'
create table if not exists orders (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  table_id      uuid references restaurant_tables(id) on delete set null,
  table_label   text,                            -- denormalised for display
  status        text not null default 'pending_payment',
  subtotal      numeric not null default 0,
  service_fee   numeric not null default 0,
  tip           numeric not null default 0,
  total         numeric not null default 0,
  currency      text not null default 'MXN',
  -- line items snapshot: [{ name, emoji, price, qty, mods: {}, notes }]
  items         jsonb not null default '[]'::jsonb,
  note          text,                            -- whole-order note
  -- Money taken off this order (item discounts + promos + coupon), and which
  -- coupon did it. promo_detail keeps the per-promo breakdown for the records.
  discount      numeric not null default 0,
  coupon_code   text,
  promo_detail  jsonb,
  pay_method    text,                            -- 'card' | 'apple' | 'google' | 'paypal'
  stripe_session_id text,
  stripe_payment_intent text,
  stripe_refund_id text,                         -- set when a cancelled order was refunded
  paid          boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Migration for databases created before is_addon existed.
alter table menu_items add column if not exists is_addon boolean not null default false;

-- Dietary / allergen tags (keys from src/lib/dietary.ts), shown to customers.
alter table menu_items add column if not exists dietary text[] not null default '{}';

-- Migration for databases created before menus existed.
alter table categories add column if not exists menu_id uuid references menus(id) on delete cascade;
alter table menu_items add column if not exists menu_id uuid references menus(id) on delete cascade;

-- Keep the owner-editable service charge in a sane range. The owner writes this
-- via RLS, so a hand-crafted request can't be trusted — enforce 0–30% in the DB
-- (checkout multiplies by service_pct/100). Re-add idempotently.
alter table restaurants add column if not exists accepting_orders boolean not null default true;
alter table restaurants add column if not exists service_enabled boolean not null default false;
alter table restaurants add column if not exists tax_pct numeric not null default 0;
alter table restaurants add column if not exists tax_show_breakdown boolean not null default false;
alter table restaurants add column if not exists stripe_account_id text;
alter table restaurants add column if not exists stripe_charges_enabled boolean not null default false;
alter table orders add column if not exists stripe_refund_id text;
alter table orders add column if not exists tip numeric not null default 0;
alter table orders add column if not exists tax_pct numeric not null default 0;

-- Discounts & promotions.
alter table menu_items add column if not exists discount_pct numeric not null default 0;
alter table orders     add column if not exists discount numeric not null default 0;
alter table orders     add column if not exists coupon_code text;
alter table orders     add column if not exists promo_detail jsonb;

-- A discount can never be negative or wipe out the item entirely (100% off would
-- also break Stripe's minimum charge). Managers write this through RLS, so the
-- range has to hold in the DB, not just the form.
alter table menu_items drop constraint if exists menu_items_discount_pct_range;
alter table menu_items add constraint menu_items_discount_pct_range
  check (discount_pct >= 0 and discount_pct < 100);

alter table restaurants drop constraint if exists restaurants_service_pct_range;
alter table restaurants add constraint restaurants_service_pct_range
  check (service_pct >= 0 and service_pct <= 30);

alter table restaurants drop constraint if exists restaurants_tax_pct_range;
alter table restaurants add constraint restaurants_tax_pct_range
  check (tax_pct >= 0 and tax_pct <= 100);

-- ── Item add-ons ────────────────────────────────────────────────────────────
-- Many-to-many: which add-on items can be added to which product.
-- Both sides are menu_items; the add-on side has is_addon = true.
create table if not exists item_addons (
  product_id uuid not null references menu_items(id) on delete cascade,
  addon_id   uuid not null references menu_items(id) on delete cascade,
  sort_order int not null default 0,
  primary key (product_id, addon_id)
);

-- short human-friendly code for display (ORD-XXXX) derived from id
create index if not exists orders_restaurant_idx on orders(restaurant_id, created_at desc);
create index if not exists orders_status_idx on orders(restaurant_id, status);

-- ── Service requests (customer taps "call waiter" / "request bill") ─────────
create table if not exists service_requests (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  table_id      uuid references restaurant_tables(id) on delete cascade,
  table_label   text not null,
  kind          text not null check (kind in ('waiter', 'bill')),
  status        text not null default 'open',  -- 'open' | 'done'
  created_at    timestamptz not null default now()
);

create index if not exists service_requests_open_idx
  on service_requests(restaurant_id, status, created_at desc);

-- ── Staff (kitchen logins the owner creates for the orders board) ───────────
create table if not exists staff (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  user_id       uuid not null unique references auth.users(id) on delete cascade,
  email         text not null,
  role          text not null default 'kitchen',  -- 'owner' (co-owner) | 'manager' | 'waiter' | 'kitchen'
  created_at    timestamptz not null default now()
);

alter table staff add column if not exists role text not null default 'kitchen';
alter table staff drop constraint if exists staff_role_check;
alter table staff add constraint staff_role_check
  check (role in ('owner', 'manager', 'waiter', 'kitchen'));

create index if not exists staff_restaurant_idx on staff(restaurant_id);

-- A reset that drops/recreates `restaurants` silently removes this FK from a
-- surviving staff table — restore it idempotently so rows can't orphan again.
do $$ begin
  alter table staff add constraint staff_restaurant_id_fkey
    foreign key (restaurant_id) references restaurants(id) on delete cascade;
exception when duplicate_object then null; end $$;

-- ── Platform admins (highest permission level — power over the whole app) ───
-- Checked ONLY server-side with the secret key: RLS is enabled with no
-- policies, so no client key (anon or authenticated) can read or write it.
create table if not exists platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  created_at timestamptz not null default now()
);
alter table platform_admins enable row level security;

-- ── User activity log (who created/updated/deleted which login) ─────────────
-- Written ONLY server-side by the user-management API routes; the restaurant's
-- owners are the only readers.
create table if not exists user_logs (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  actor_email   text not null,                     -- who did it
  action        text not null check (action in ('created', 'updated', 'deleted')),
  target_role   text not null,                     -- role of the affected login
  target_email  text not null,                     -- the affected login
  created_at    timestamptz not null default now()
);

create index if not exists user_logs_restaurant_idx on user_logs(restaurant_id, created_at desc);

-- ── Profiles (a user's own basic info — name; email/password live in auth) ──
create table if not exists profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null default '',
  updated_at timestamptz not null default now()
);

-- ── Promotions (combo packages and quantity deals) ──────────────────────────
-- Cross-item offers, so they get their own table — a single-item sale price is
-- just menu_items.discount_pct. Three kinds:
--   'combo'  — a bundle sold at combo_price (components in promotion_items)
--   'bogo'   — buy N, pay for M (2x1 => buy_qty 2, pay_qty 1)
--   'tiered' — bracket pricing, tiers = [{"qty":1,"price":5},{"qty":2,"price":8}]
-- Public data (customers must see the offers), so anon gets SELECT below.
create table if not exists promotions (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  kind          text not null check (kind in ('combo', 'bogo', 'tiered')),
  name          text not null,
  emoji         text not null default '🎁',
  description   text,
  combo_price   numeric,        -- kind='combo'
  buy_qty       int,            -- kind='bogo'
  pay_qty       int,            -- kind='bogo'
  tiers         jsonb,          -- kind='tiered'
  active        boolean not null default true,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

-- Which items a promotion covers. For a combo, qty is how many of that item the
-- bundle includes; for bogo/tiered it's the product the deal applies to.
create table if not exists promotion_items (
  promotion_id uuid not null references promotions(id) on delete cascade,
  item_id      uuid not null references menu_items(id) on delete cascade,
  qty          int not null default 1,
  primary key (promotion_id, item_id)
);

create index if not exists promotions_restaurant_idx on promotions(restaurant_id, sort_order);

-- ── Coupons ─────────────────────────────────────────────────────────────────
-- Codes an owner/manager hands out (see src/lib/coupons.ts for the format).
-- SECRET: unlike promotions, this table must never be readable by the browser —
-- anon SELECT here would hand every customer the whole code list. Validation
-- happens server-side only, through /api/coupons/validate with the secret key.
create table if not exists coupons (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  code          text not null,
  kind          text not null check (kind in ('percent', 'fixed')),
  value         numeric not null check (value > 0),
  max_uses      int check (max_uses is null or max_uses > 0),  -- null = unlimited
  uses_count    int not null default 0,
  min_subtotal  numeric not null default 0,
  active        boolean not null default true,
  starts_at     timestamptz,
  ends_at       timestamptz,
  created_by_email text,
  created_at    timestamptz not null default now()
);
-- One code per restaurant, case-insensitively — codes are compared upper-cased.
create unique index if not exists coupons_code_idx on coupons(restaurant_id, upper(code));

-- Every successful redemption, for the owner's records.
create table if not exists coupon_redemptions (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  coupon_id     uuid references coupons(id) on delete set null,
  order_id      uuid references orders(id) on delete set null,
  code          text not null,
  amount        numeric not null,
  created_at    timestamptz not null default now()
);
create index if not exists coupon_redemptions_idx
  on coupon_redemptions(restaurant_id, created_at desc);

-- ── Realtime: broadcast order changes to dashboard + customer ───────────────
do $$ begin
  alter publication supabase_realtime add table orders;
exception when duplicate_object then null;  -- already added; safe to re-run
end $$;

do $$ begin
  alter publication supabase_realtime add table service_requests;
exception when duplicate_object then null;
end $$;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table restaurants        enable row level security;
alter table restaurant_tables  enable row level security;
alter table menus              enable row level security;
alter table categories         enable row level security;
alter table menu_items         enable row level security;
alter table item_addons        enable row level security;
alter table orders             enable row level security;

-- PUBLIC READ: anyone with the QR can read the restaurant's menu (no login).
-- These tables hold no sensitive data — just the public menu.
-- (drop-if-exists before each create keeps this script safe to re-run.)
drop policy if exists "public read restaurants" on restaurants;
create policy "public read restaurants"
  on restaurants for select using (true);

-- Defense in depth — lock the anon (publishable-key) role down to READ-ONLY on
-- just the public menu. Supabase grants every new table ALL privileges to anon
-- by default, leaving RLS as the *only* thing between a browser key and the
-- data. But this app never writes as anon: every insert/update goes through the
-- secret key (service_role), which bypasses RLS. So we strip anon to nothing,
-- then re-grant only the public reads the customer menu needs. Re-run on every
-- `db:create`, so tables added later get stripped too.
revoke all on all tables in schema public from anon;
grant select on restaurant_tables, menus, categories, menu_items, item_addons to anon;
-- Promotions are public offers — the customer menu renders them. Note what is
-- NOT here: `coupons` and `coupon_redemptions`. A coupon code is a secret the
-- customer is supposed to be told out-of-band, so anon must never read that
-- table; codes are checked server-side by /api/coupons/validate. The blanket
-- revoke above already stripped them, and the belt-and-braces revoke below
-- keeps that true even if this file is re-ordered.
grant select on promotions, promotion_items to anon;
revoke all on coupons, coupon_redemptions from anon;

-- Column-level guard on restaurants: the public (anon) role sees only a
-- restaurant's display columns — never owner_id or created_at. RLS decides
-- which ROWS are visible; this decides which COLUMNS. The dashboard
-- (authenticated owner) and the secret key keep full access.
grant select (id, name, tagline, logo, currency, service_pct, service_enabled, accepting_orders, tax_pct, tax_show_breakdown) on restaurants to anon;
grant select on restaurants to authenticated;

-- authenticated (logged-in staff) keeps the DML its dashboard needs — those
-- writes are gated by the RLS policies below. But it never needs the
-- table-shaping privileges, and RLS does not guard those, so drop them.
revoke truncate, references, trigger on all tables in schema public from authenticated;

drop policy if exists "public read tables" on restaurant_tables;
create policy "public read tables"
  on restaurant_tables for select using (true);

-- Only ACTIVE menus are public. Owners still see their inactive menus via the
-- "owner manages menus" policy below (FOR ALL covers SELECT).
drop policy if exists "public read menus" on menus;
create policy "public read menus"
  on menus for select using (active = true);

-- A category is public only if its menu is active.
drop policy if exists "public read categories" on categories;
create policy "public read categories"
  on categories for select
  using (exists (select 1 from menus m where m.id = menu_id and m.active));

-- An item (product or add-on) is public only if it's available AND its menu is
-- active. Owners still see unavailable/hidden items via "owner manages menu".
drop policy if exists "public read available menu" on menu_items;
create policy "public read available menu"
  on menu_items for select
  using (available and exists (select 1 from menus m where m.id = menu_id and m.active));

drop policy if exists "public read item addons" on item_addons;
create policy "public read item addons"
  on item_addons for select using (true);

-- Ownership check used by the policies below. SECURITY DEFINER so it can read
-- `restaurants` on the caller's behalf — the anon role no longer has direct
-- SELECT on that table (see the column-level guard above), so a plain
-- `select 1 from restaurants …` inside a policy would fail with "permission
-- denied for table restaurants" when a customer reads menus/items. auth.uid()
-- is still the caller's (it reads the request JWT, not the function owner).
create or replace function public.owns_restaurant(rid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  -- The founding owner (restaurants.owner_id) or a co-owner (staff role
  -- 'owner') — both hold full owner powers everywhere this is used.
  select exists (select 1 from restaurants r where r.id = rid and r.owner_id = auth.uid())
      or exists (select 1 from staff s
                 where s.restaurant_id = rid and s.user_id = auth.uid() and s.role = 'owner');
$$;
revoke all on function public.owns_restaurant(uuid) from public;
grant execute on function public.owns_restaurant(uuid) to anon, authenticated;

-- Membership check: the owner OR one of their staff. Same SECURITY DEFINER
-- reasoning as owns_restaurant — policies on other tables call this.
create or replace function public.works_at(rid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select owns_restaurant(rid)
      or exists (select 1 from staff s where s.restaurant_id = rid and s.user_id = auth.uid());
$$;
revoke all on function public.works_at(uuid) from public;
grant execute on function public.works_at(uuid) to anon, authenticated;

-- Role check: the owner always qualifies; staff qualify when their role is in
-- the list. Used to give managers owner-grade powers over menus/tables.
create or replace function public.has_role(rid uuid, roles text[])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select owns_restaurant(rid)
      or exists (select 1 from staff s
                 where s.restaurant_id = rid and s.user_id = auth.uid() and s.role = any(roles));
$$;
revoke all on function public.has_role(uuid, text[]) from public;
grant execute on function public.has_role(uuid, text[]) to anon, authenticated;

-- ── Rate limiting ───────────────────────────────────────────────────────────
-- A tiny shared counter so the public API routes (checkout, service requests,
-- signup) can throttle abusive callers. One row per bucket (e.g. "checkout:1.2.3.4"),
-- reset whenever its fixed window elapses. Written only by the secret key via
-- rate_limit_hit(); RLS-on with no policies keeps every client role out.
create table if not exists rate_limits (
  bucket       text primary key,
  count        int not null default 0,
  window_start timestamptz not null default now()
);
alter table rate_limits enable row level security;
-- Only the secret key (via rate_limit_hit) ever touches this table. The anon
-- lockdown above ran before this table existed, so strip the default grants
-- here too — RLS is then a second line of defence, not the only one.
revoke all on rate_limits from anon, authenticated;

-- Atomically bump a bucket's counter and return its new count for the current
-- window. Callers compare the result against their own limit. SECURITY DEFINER
-- so it works regardless of the caller's row-level access to rate_limits.
create or replace function public.rate_limit_hit(p_bucket text, p_window_seconds int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into rate_limits (bucket, count, window_start)
  values (p_bucket, 1, now())
  on conflict (bucket) do update set
    count = case
      when rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
      then 1 else rate_limits.count + 1 end,
    window_start = case
      when rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
      then now() else rate_limits.window_start end
  returning count into v_count;
  return v_count;
end;
$$;
-- Only the secret key may bump counters. Supabase's default privileges grant
-- execute to anon/authenticated too, so revoke from them explicitly — otherwise
-- anyone could inflate another caller's bucket and grief them into a 429.
revoke all on function public.rate_limit_hit(text, int) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, int) to service_role;

-- STAFF table access: the owner manages their staff list (inserts happen only
-- server-side — /api/staff creates the login with the secret key); a staff
-- member can read their own membership row (the dashboard resolves their
-- restaurant through it).
alter table staff enable row level security;
drop policy if exists "owner reads staff" on staff;
create policy "owner reads staff"
  on staff for select
  using (owns_restaurant(restaurant_id));
drop policy if exists "owner deletes staff" on staff;
create policy "owner deletes staff"
  on staff for delete
  using (owns_restaurant(restaurant_id));
drop policy if exists "staff reads own membership" on staff;
create policy "staff reads own membership"
  on staff for select
  using (user_id = auth.uid());

-- PROFILES: each user manages only their own row; the owner can additionally
-- read their staff's profiles so the Staff page can show real names.
alter table profiles enable row level security;
drop policy if exists "own profile" on profiles;
create policy "own profile"
  on profiles for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
drop policy if exists "owner reads staff profiles" on profiles;
create policy "owner reads staff profiles"
  on profiles for select
  using (exists (select 1 from staff s
                 where s.user_id = profiles.user_id and owns_restaurant(s.restaurant_id)));

-- ORDERS:
-- Orders hold customer notes (PII) and payment references, so the public
-- (client) key must NOT be able to read them. A blanket `using (true)` SELECT
-- policy can't restrict to a single id — RLS can't force a WHERE clause, so it
-- would let anyone dump the whole table. Instead:
--   • The restaurant owner reads THEIR orders (policy below) for the dashboard.
--   • The customer's order-tracker reads its single order server-side, by its
--     unguessable id, via the secret key (see src/app/order/[orderId]/page.tsx
--     and /api/order-status). The publishable key gets no order access at all.
drop policy if exists "read order by id" on orders;   -- removed: was over-permissive
drop policy if exists "owner reads orders" on orders; -- superseded by team read below
drop policy if exists "team reads orders" on orders;
create policy "team reads orders"
  on orders for select
  using (works_at(restaurant_id));

-- INSERT/UPDATE on orders is done ONLY server-side via the secret key, which
-- bypasses RLS. So we intentionally add NO insert/update policies here:
-- the publishable (client) key cannot create or mutate orders directly.

-- SERVICE REQUESTS: customers create them ONLY via /api/service-requests
-- (secret key, validates the table), so no anon insert policy. The owner
-- sees their own restaurant's requests and can mark them done.
alter table service_requests enable row level security;
drop policy if exists "owner reads service requests" on service_requests;
drop policy if exists "team reads service requests" on service_requests;
create policy "team reads service requests"
  on service_requests for select
  using (works_at(restaurant_id));
drop policy if exists "owner updates service requests" on service_requests;
drop policy if exists "team updates service requests" on service_requests;
create policy "team updates service requests"
  on service_requests for update
  using (works_at(restaurant_id))
  with check (works_at(restaurant_id));

-- OWNER WRITE: the logged-in restaurant owner manages their own menu/tables.
-- owns_restaurant() covers co-owners (staff role 'owner') too.
drop policy if exists "owner manages restaurant" on restaurants;
create policy "owner manages restaurant"
  on restaurants for all
  using (owns_restaurant(id))
  with check (owns_restaurant(id));

-- USER LOGS: owners read their restaurant's log; writes happen only
-- server-side from the user-management API routes (secret key).
alter table user_logs enable row level security;
drop policy if exists "owner reads user logs" on user_logs;
create policy "owner reads user logs"
  on user_logs for select
  using (owns_restaurant(restaurant_id));

drop policy if exists "owner manages tables" on restaurant_tables;
drop policy if exists "team manages tables" on restaurant_tables;
create policy "team manages tables"
  on restaurant_tables for all
  using (has_role(restaurant_id, array['manager']))
  with check (has_role(restaurant_id, array['manager']));

drop policy if exists "owner manages menus" on menus;
drop policy if exists "team manages menus" on menus;
create policy "team manages menus"
  on menus for all
  using (has_role(restaurant_id, array['manager']))
  with check (has_role(restaurant_id, array['manager']));

drop policy if exists "owner manages categories" on categories;
drop policy if exists "team manages categories" on categories;
create policy "team manages categories"
  on categories for all
  using (has_role(restaurant_id, array['manager']))
  with check (has_role(restaurant_id, array['manager']));

drop policy if exists "owner manages menu" on menu_items;
drop policy if exists "team manages menu" on menu_items;
create policy "team manages menu"
  on menu_items for all
  using (has_role(restaurant_id, array['manager']))
  with check (has_role(restaurant_id, array['manager']));

-- Owner manages add-on links for products in their restaurant.
drop policy if exists "owner manages item addons" on item_addons;
drop policy if exists "team manages item addons" on item_addons;
create policy "team manages item addons"
  on item_addons for all
  using (has_role((select mi.restaurant_id from menu_items mi where mi.id = product_id), array['manager']))
  with check (has_role((select mi.restaurant_id from menu_items mi where mi.id = product_id), array['manager']));

-- PROMOTIONS: public reads the active offers (they're part of the menu);
-- owners and managers manage them, same as menus and items.
alter table promotions      enable row level security;
alter table promotion_items enable row level security;

drop policy if exists "public read promotions" on promotions;
create policy "public read promotions"
  on promotions for select using (active = true);

drop policy if exists "team manages promotions" on promotions;
create policy "team manages promotions"
  on promotions for all
  using (has_role(restaurant_id, array['manager']))
  with check (has_role(restaurant_id, array['manager']));

drop policy if exists "public read promotion items" on promotion_items;
create policy "public read promotion items"
  on promotion_items for select using (true);

drop policy if exists "team manages promotion items" on promotion_items;
create policy "team manages promotion items"
  on promotion_items for all
  using (has_role((select p.restaurant_id from promotions p where p.id = promotion_id), array['manager']))
  with check (has_role((select p.restaurant_id from promotions p where p.id = promotion_id), array['manager']));

-- COUPONS: owners and managers manage their restaurant's codes. There is
-- deliberately NO public policy — plus anon has no grant at all (see above), so
-- a customer cannot read or enumerate codes even if a policy were added by
-- mistake. Redemption goes through redeem_coupon() with the secret key.
alter table coupons            enable row level security;
alter table coupon_redemptions enable row level security;

drop policy if exists "team manages coupons" on coupons;
create policy "team manages coupons"
  on coupons for all
  using (has_role(restaurant_id, array['manager']))
  with check (has_role(restaurant_id, array['manager']));

-- Redemptions are written server-side only (secret key), so read-only here.
drop policy if exists "team reads coupon redemptions" on coupon_redemptions;
create policy "team reads coupon redemptions"
  on coupon_redemptions for select
  using (has_role(restaurant_id, array['manager']));

-- Claim one use of a coupon, atomically. The eligibility test lives in the
-- UPDATE's WHERE clause so Postgres row-locking serialises concurrent callers —
-- two customers racing for the last use cannot both win. Returns the new count,
-- or NULL when the coupon didn't qualify (limit reached, inactive, or expired).
-- Same hardening as rate_limit_hit: SECURITY DEFINER with a pinned search_path,
-- and executable only by the secret key.
create or replace function public.redeem_coupon(p_coupon_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uses int;
begin
  update coupons set uses_count = uses_count + 1
   where id = p_coupon_id
     and active
     and (max_uses is null or uses_count < max_uses)
     and (starts_at is null or starts_at <= now())
     and (ends_at   is null or ends_at   >  now())
  returning uses_count into v_uses;
  return v_uses;
end;
$$;
revoke all on function public.redeem_coupon(uuid) from public, anon, authenticated;
grant execute on function public.redeem_coupon(uuid) to service_role;

-- Give a claimed use back when the checkout that reserved it never completed
-- (Stripe refused the session, or the order was cancelled). Floors at zero so a
-- double-release can't drive the count negative.
create or replace function public.release_coupon(p_coupon_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update coupons set uses_count = greatest(0, uses_count - 1) where id = p_coupon_id;
end;
$$;
revoke all on function public.release_coupon(uuid) from public, anon, authenticated;
grant execute on function public.release_coupon(uuid) to service_role;

-- ============================================================================
-- Backfill: every restaurant needs at least one menu. Restaurants (and their
-- categories/items) created before menus existed get a default "Main Menu" and
-- their content is assigned to it. Idempotent — only touches null menu_ids.
-- ============================================================================
do $$
declare
  r   record;
  mid uuid;
begin
  for r in select id from restaurants loop
    select id into mid from menus where restaurant_id = r.id order by sort_order, created_at limit 1;
    if mid is null then
      insert into menus (restaurant_id, name, active, sort_order)
      values (r.id, 'Main Menu', true, 0)
      returning id into mid;
    end if;
    update categories set menu_id = mid where restaurant_id = r.id and menu_id is null;
    update menu_items set menu_id = mid where restaurant_id = r.id and menu_id is null;
  end loop;
end $$;

-- Demo seed data lives separately in supabase/seed.sql
--   pnpm db:create  → this file (structure only)
--   pnpm db:seed    → seed.sql  (demo restaurant + menu)
--   pnpm db:reset   → drop + create + seed
