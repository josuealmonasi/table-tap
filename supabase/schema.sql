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

-- Cover photo shown above the menu header. Off by default, so a restaurant
-- that never sets one looks exactly as it did before this existed.
alter table restaurants add column if not exists cover_url text;
alter table restaurants add column if not exists cover_enabled boolean not null default false;

-- The restaurant's own mark, shown as the avatar over the cover and beside the
-- name. Takes precedence over the `logo` emoji, which stays as the fallback for
-- a restaurant that hasn't got artwork.
alter table restaurants add column if not exists logo_url text;

-- "Pay at the end / at the counter": food can leave before it is paid for.
-- Off by default, because that is a risk the restaurant chooses to take and
-- not one we take on its behalf.
--
-- One switch, because it is one decision. What changes with the QR is who
-- holds the order, and the owner does not choose that: at a table the table
-- holds it — the bill stays open and a waiter collects at the end — and on the
-- general QR, where there is no table to come back to, the counter holds it:
-- the diner walks to the till, pays and collects. This was two columns and
-- they contradicted each other — with one on and the other off, the general
-- QR's cart gave the diner no way out of it at all.
alter table restaurants add column if not exists allow_pay_later boolean not null default false;

-- The "Combos y ofertas" tab on the diner's menu. On by default — a
-- restaurant running promotions wants them seen — and switchable off for
-- anyone it gets in the way of.
alter table restaurants add column if not exists deals_tab_enabled boolean not null default true;


-- The hottest lookup in the app: getMembership asks "which restaurant does this
-- user own?" on every request, and has_role() asks it again inside every RLS
-- policy check. Without this it is a sequential scan — free at seven rows,
-- linear in the number of restaurants on the platform.
create index if not exists restaurants_owner_idx on restaurants(owner_id);

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

-- Optional opening hours for a menu. Null (or disabled) means the menu is
-- driven by `active` alone, which is how every menu behaved before this
-- existed. Shape:
--   { "enabled": true,
--     "rules": [{ "days": [1,2,3,4,5], "allDay": false,
--                 "start": "12:00", "end": "17:00" }] }
-- days are 0=Sunday..6=Saturday. `active` still wins: a menu switched off is
-- off whatever the schedule says.
alter table menus add column if not exists schedule jsonb;

-- Opening hours are local to the restaurant, so they need a zone to be
-- evaluated in. IANA name; the default matches the app's MXN/es-MX footing.
alter table restaurants add column if not exists timezone text not null
  default 'America/Mexico_City';

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
  -- Served but never paid for: a dine-in table that left without settling. Not
  -- cancelled — the food went out and the kitchen spent it — and not paid, so
  -- it stays out of revenue. Recording it is what lets the board be cleared
  -- without pretending the money arrived.
  written_off   boolean not null default false,
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
  kind          text not null check (kind in ('waiter', 'bill', 'pay')),
  status        text not null default 'open',  -- 'open' | 'done'
  created_at    timestamptz not null default now()
);

-- 'pay' arrives when a table asks to settle in person: the waiter takes cash or
-- a card at the table and marks the orders paid. Existing rows predate it, so
-- the constraint is replaced rather than assumed.
do $$ begin
  alter table service_requests drop constraint if exists service_requests_kind_check;
  alter table service_requests add constraint service_requests_kind_check
    check (kind in ('waiter', 'bill', 'pay'));
exception when others then null;
end $$;

create index if not exists service_requests_open_idx
  on service_requests(restaurant_id, status, created_at desc);

-- ── Staff (kitchen logins the owner creates for the orders board) ───────────
create table if not exists staff (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  user_id       uuid not null unique references auth.users(id) on delete cascade,
  email         text not null,
  role          text not null default 'kitchen',  -- 'owner' (co-owner) | 'manager' | 'waiter' | 'cashier' | 'kitchen'
  created_at    timestamptz not null default now()
);

alter table staff add column if not exists role text not null default 'kitchen';
alter table staff drop constraint if exists staff_role_check;
alter table staff add constraint staff_role_check
  check (role in ('owner', 'manager', 'waiter', 'cashier', 'kitchen'));

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
-- No policy: RLS with no policy denies everything, which is exactly what we
-- want — who runs the whole platform is readable only with the service key.
-- The grants come off anyway: a grant nothing uses is a grant somebody
-- inherits the day a policy is added "to unblock something".
revoke all on platform_admins from anon, authenticated;

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

-- The log started as a record of who touched which login. Everything else
-- worth answering "who did that?" about — a bill settled in cash, a debt
-- written off, a promotion applied to a table, an order cancelled, the tax
-- rate changed — belongs in the same place, or an owner has to ask three
-- screens. So the row widens: `entity` says what kind of thing was acted on,
-- `detail` carries the human-readable specifics, and the staff-only columns
-- become optional.
alter table user_logs add column if not exists entity text not null default 'staff';
alter table user_logs add column if not exists detail text;
alter table user_logs alter column target_role drop not null;
alter table user_logs alter column target_email drop not null;
alter table user_logs drop constraint if exists user_logs_action_check;
create index if not exists user_logs_action_idx on user_logs(restaurant_id, action);

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
-- A code the floor applies, never the diner: the "show your membership card"
-- kind of promotion, where there is nothing for a customer to type. Hidden
-- from the customer's validate endpoint, so guessing one gets nowhere.
alter table coupons add column if not exists staff_only boolean not null default false;

-- One code per restaurant, case-insensitively — codes are compared upper-cased.
create unique index if not exists coupons_code_idx on coupons(restaurant_id, upper(code));

-- Every redemption, for the owner's records. A row is written when checkout
-- RESERVES a use; confirmed_at is stamped once Stripe says the order was paid.
-- An unconfirmed row is an in-flight (or abandoned) checkout, not a real use.
create table if not exists coupon_redemptions (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  coupon_id     uuid references coupons(id) on delete set null,
  order_id      uuid references orders(id) on delete set null,
  code          text not null,
  amount        numeric not null,
  confirmed_at  timestamptz,
  created_at    timestamptz not null default now()
);
alter table coupon_redemptions add column if not exists confirmed_at timestamptz;
create index if not exists coupon_redemptions_idx
  on coupon_redemptions(restaurant_id, created_at desc);

-- ── Image storage ───────────────────────────────────────────────────────────
-- One public bucket for menu photography: the restaurant cover and per-dish
-- pictures. Public read is deliberate — these are printed on a QR poster and
-- shown to anyone who scans it, so there is nothing to protect on the way out.
--
-- Writes are the part that matters. The first path segment is the restaurant
-- id, so `has_role` decides who may upload where:
--     <restaurantId>/cover.webp
--     <restaurantId>/items/<itemId>.webp
-- Uploads go straight from the owner's browser with their own session, so the
-- secret key never touches this path and RLS is the only thing granting it.
insert into storage.buckets (id, name, public)
values ('menu', 'menu', true)
on conflict (id) do nothing;

-- Reads the restaurant id out of an object path, or null when the path is not
-- shaped like one. Kept as a function because a bare `::uuid` cast raises on
-- anything else, and a policy that can raise is a policy that can be tripped
-- ── Policy helpers ─────────────────────────────────────────────────────────
-- Defined before anything that calls them. They used to sit further down, and
-- the storage policies above referenced them from a hundred lines earlier —
-- which only ever worked because a reset left the old functions behind. On a
-- genuinely empty database the schema could not build itself.
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


-- over by a junk key. has_role(null, ...) is false, so null denies.
create or replace function public.storage_restaurant(object_name text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
begin
  return (split_part(object_name, '/', 1))::uuid;
exception when others then
  return null;
end $$;
revoke all on function public.storage_restaurant(text) from public;
grant execute on function public.storage_restaurant(text) to anon, authenticated;

do $$ begin
  create policy "menu images are public to read" on storage.objects
    for select using (bucket_id = 'menu');
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "team manages its own menu images" on storage.objects
    for all
    using (
      bucket_id = 'menu'
      and has_role(storage_restaurant(name), array['manager'])
    )
    with check (
      bucket_id = 'menu'
      and has_role(storage_restaurant(name), array['manager'])
    );
exception when duplicate_object then null;
end $$;

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
grant select on menus, categories, menu_items, item_addons to anon;
-- restaurant_tables is deliberately NOT here. A table id is the only thing
-- between a caller and a table's bill — and, where a restaurant takes payment
-- at the end, between a caller and an order charged to somebody else's table.
-- Listable, those ids stop being secrets: the publishable key ships in every
-- browser, so one query returned every table of every restaurant. The customer
-- page reads its own table with the secret key instead, scoped to the ids in
-- the URL, which puts the QR code back in the position of being the thing you
-- have to hold.
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
-- Column-scoped on purpose: owner_id, Stripe ids and timestamps stay unreadable.
-- A new column is invisible to customers until it is listed here, and it fails
-- silently — the value simply reads as null.
-- `timezone` va en la lista porque el menú lo lee para decidir qué carta está
-- abierta a esta hora. Sin el permiso la lectura fallaba y caía en
-- America/Mexico_City sin decir nada: hoy no se nota porque todos los
-- restaurantes están ahí, y el día que entre uno en Cancún o Tijuana sus
-- horarios de menú abrirían a la hora equivocada.
grant select (id, name, tagline, logo, currency, service_pct, service_enabled, accepting_orders, tax_pct, tax_show_breakdown, cover_url, cover_enabled, logo_url, allow_pay_later, timezone, deals_tab_enabled) on restaurants to anon;

-- And `authenticated` sees exactly the same, not the whole table. The revoke
-- comes first on purpose: granting columns does NOT remove a grant already
-- given on the entire table, so without this line the list below changes
-- nothing. We learned that by running it and watching the leak stay open.
revoke select on restaurants from authenticated;
-- And `authenticated` sees exactly the same, not the whole table.
--
-- The row policy on `restaurants` is `using (true)` on purpose: the menu hangs
-- off a QR code and anyone may read it, signed in or not. But a column grant
-- does not distinguish rows — with SELECT over the whole table, any signed-in
-- account could read the owner_id, the plan, the billing state and the Stripe
-- accounts of EVERY restaurant. We confirmed it with the kitchen login, which
-- has the fewest permissions of any.
--
-- The private columns are read with the service key now, and always scoped to
-- the restaurant of whoever is asking (see getMembership).
grant select (id, name, tagline, logo, currency, service_pct, service_enabled, accepting_orders, tax_pct, tax_show_breakdown, cover_url, cover_enabled, logo_url, allow_pay_later, timezone, deals_tab_enabled) on restaurants to authenticated;

-- authenticated (logged-in staff) keeps the DML its dashboard needs — those
-- writes are gated by the RLS policies below. But it never needs the
-- table-shaping privileges, and RLS does not guard those, so drop them.
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- No public select policy on restaurant_tables: the grant above is gone, and
-- the team's own "team manages tables" policy (FOR ALL) covers the dashboard.
drop policy if exists "public read tables" on restaurant_tables;

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

-- DISCOUNT REQUESTS: a waiter asking for a discount they may not grant alone.
-- The row is the ask; approving it is what actually moves money, and only a
-- manager or owner can do that.
create table if not exists discount_requests (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  table_id      uuid references restaurant_tables(id) on delete set null,
  table_label   text,
  order_ids     uuid[] not null,
  code          text not null,
  amount        numeric not null default 0,
  requested_by  text not null,
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected')),
  decided_by    text,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);
create index if not exists discount_requests_open_idx
  on discount_requests(restaurant_id, status, created_at desc);
alter table discount_requests enable row level security;
drop policy if exists "team handles discount requests" on discount_requests;
create policy "team handles discount requests"
  on discount_requests for all
  using (has_role(restaurant_id, array['owner', 'manager', 'waiter', 'cashier']))
  with check (has_role(restaurant_id, array['owner', 'manager', 'waiter', 'cashier']));
-- Never a customer's business: the ask names staff and carries a code.
revoke all on discount_requests from anon;

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

-- ═══════════════════════════════════════════════════════════════════════════
-- Dish ratings
-- ═══════════════════════════════════════════════════════════════════════════
-- One 1–5 star rating per dish per order. Keying on the ORDER, not a person,
-- is what makes "only people who bought it can rate it" enforceable without
-- accounts: a rating must name a paid order that actually contains the dish,
-- so the cost of a fake review is the price of the dish.
create table if not exists dish_ratings (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  item_id       uuid not null references menu_items(id) on delete cascade,
  order_id      uuid not null references orders(id) on delete cascade,
  rating        int  not null check (rating between 1 and 5),
  created_at    timestamptz not null default now(),
  -- Rate a dish once per order. Ordering it twice on separate visits earns a
  -- second say; clicking the stars twice on one visit does not.
  unique (order_id, item_id)
);
create index if not exists dish_ratings_item_idx on dish_ratings(item_id);
create index if not exists dish_ratings_restaurant_idx
  on dish_ratings(restaurant_id, created_at desc);

alter table dish_ratings enable row level security;

-- The team can read its own ratings (for a future reviews view). Nobody writes
-- through the API: every insert goes through the server route, which re-checks
-- the order against the database first.
drop policy if exists "team reads dish ratings" on dish_ratings;
create policy "team reads dish ratings" on dish_ratings for select
  using (has_role(restaurant_id, array['manager']));

-- Customers must never read the raw rows — that would expose which order rated
-- what, and at a quiet table that is one diner's opinion with their name in
-- reach. The blanket anon lockdown earlier in this file ran before this table
-- existed (the same trap rate_limits and coupons hit), so revoke here too.
revoke all on dish_ratings from anon, authenticated;

-- Aggregates only, for the menu. security definer so it can read past the RLS
-- above while still returning nothing that identifies an order.
--
-- Below MIN_RATINGS the dish is reported as unrated rather than shown with a
-- thin average: one 5-star rating displayed as "5.0" reads as a track record
-- and isn't one.
create or replace function public.dish_rating_stats(p_restaurant_id uuid)
returns table (item_id uuid, avg_rating numeric, rating_count bigint)
language sql
security definer
stable
set search_path = public
as $$
  select r.item_id,
         round(avg(r.rating)::numeric, 1) as avg_rating,
         count(*)                          as rating_count
    from dish_ratings r
   where r.restaurant_id = p_restaurant_id
   group by r.item_id
  having count(*) >= 3;
$$;
revoke all on function public.dish_rating_stats(uuid) from public;
grant execute on function public.dish_rating_stats(uuid) to anon, authenticated;

-- ── Icon groups ────────────────────────────────────────────────────────────
-- The tabs in the emoji picker ("Condimentos", "Complementos de bebida").
-- They were fixed in the code; this lets each restaurant build its own.
--
-- A diner never sees any of it: a dish stores its emoji as text, so these
-- groups exist only while somebody is choosing one. That is why `anon` has
-- nothing here.
create table if not exists icon_groups (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  -- Two separate palettes: dishes do not share icons with extras.
  variant       text not null check (variant in ('product', 'addon')),
  name          text not null,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists icon_groups_restaurant_idx
  on icon_groups(restaurant_id, variant, sort_order);

create table if not exists icon_group_items (
  group_id   uuid not null references icon_groups(id) on delete cascade,
  emoji      text not null,
  label      text,
  sort_order int not null default 0,
  primary key (group_id, emoji)
);

alter table icon_groups enable row level security;
alter table icon_group_items enable row level security;

drop policy if exists "team manages icon groups" on icon_groups;
create policy "team manages icon groups" on icon_groups for all
  using (has_role(restaurant_id, array['manager']))
  with check (has_role(restaurant_id, array['manager']));

drop policy if exists "team manages icon group items" on icon_group_items;
create policy "team manages icon group items" on icon_group_items for all
  using (has_role((select g.restaurant_id from icon_groups g where g.id = group_id), array['manager']))
  with check (has_role((select g.restaurant_id from icon_groups g where g.id = group_id), array['manager']));

-- A diner never needs them: the dish already carries its emoji inside.
revoke all on icon_groups from anon;
revoke all on icon_group_items from anon;

-- ── Dietary and allergen tags ──────────────────────────────────────────────
-- Eight of them were fixed in the code. A vegan restaurant wants "crudivegano"
-- and a seafood place does not need "contiene mariscos" on its entire menu, so
-- the list belongs to them now: add, rename and remove.
--
-- A diner does read these — the tags show on the dish and filter the menu — so
-- unlike the icon groups, `anon` reads them.
create table if not exists dietary_tags (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  -- The identifier stored inside the dish. Stable: renaming a tag must not
  -- detach it from the dishes already carrying it.
  key           text not null,
  label         text not null,
  -- Optional. The eight built-in tags are translated by their `key`; a tag the
  -- restaurant invented exists only in its own words, and without this an
  -- English-reading diner would meet Spanish halfway down the menu.
  label_en      text,
  emoji         text not null default '🏷️',
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
create unique index if not exists dietary_tags_key_idx
  on dietary_tags(restaurant_id, key);
create index if not exists dietary_tags_restaurant_idx
  on dietary_tags(restaurant_id, sort_order);

alter table dietary_tags enable row level security;

drop policy if exists "public read dietary tags" on dietary_tags;
create policy "public read dietary tags" on dietary_tags for select using (true);

drop policy if exists "team manages dietary tags" on dietary_tags;
create policy "team manages dietary tags" on dietary_tags for all
  using (has_role(restaurant_id, array['manager']))
  with check (has_role(restaurant_id, array['manager']));

-- The blanket `anon` lockdown runs long before this table exists, so the
-- grant is given again here.
grant select on dietary_tags to anon;

-- The usual eight, so nobody starts with an empty list. `key` is the same one
-- the code carried, so existing dishes stay attached to theirs and the
-- translations keep working.
create or replace function public.seed_dietary_tags(p_restaurant uuid)
returns void language sql as $$
  insert into dietary_tags (restaurant_id, key, label, label_en, emoji, sort_order)
  select p_restaurant, d.key, d.label, d.label_en, d.emoji, d.ord
    from (values
      ('vegetarian',  'Vegetariano',        'Vegetarian',        '🥗', 0),
      ('vegan',       'Vegano',             'Vegan',             '🌱', 1),
      ('gluten_free', 'Sin gluten',         'Gluten-free',       '🌾', 2),
      ('dairy_free',  'Sin lácteos',        'Dairy-free',        '🥛', 3),
      ('nut_free',    'Sin frutos secos',   'Nut-free',          '🥜', 4),
      ('halal',       'Halal',              'Halal',             '☪️', 5),
      ('spicy',       'Picante',            'Spicy',             '🌶️', 6),
      ('seafood',     'Contiene mariscos',  'Contains seafood',  '🦐', 7)
    ) as d(key, label, label_en, emoji, ord)
   on conflict (restaurant_id, key) do nothing;
$$;

-- RLS already stops it — this is not `security definer`, so the insert runs
-- with the caller's permissions and the management policy refuses it — but
-- Postgres grants EXECUTE to PUBLIC on every new function, and nothing here
-- calls this one except the trigger. It is closed like the other helpers.
revoke all on function public.seed_dietary_tags(uuid) from public, anon, authenticated;
grant execute on function public.seed_dietary_tags(uuid) to service_role;

-- By trigger rather than from the sign-up route, so that every path which
-- creates a restaurant seeds them — registration, the test data, a seed run by
-- hand — and none of them can forget.
create or replace function public.seed_dietary_tags_on_new_restaurant()
returns trigger language plpgsql as $$
begin
  perform public.seed_dietary_tags(new.id);
  return new;
end; $$;

revoke all on function public.seed_dietary_tags_on_new_restaurant() from public, anon, authenticated;
grant execute on function public.seed_dietary_tags_on_new_restaurant() to service_role;

drop trigger if exists seed_dietary_tags_trg on restaurants;
create trigger seed_dietary_tags_trg after insert on restaurants
  for each row execute function public.seed_dietary_tags_on_new_restaurant();

-- And the ones that already existed.
select public.seed_dietary_tags(id) from restaurants;

-- The name a walk-in gives at the counter.
--
-- The pickup code identifies the order; this is what the cashier calls out, and
-- it is what a person answers to. Optional on purpose: it is a courtesy, not a
-- gate in front of somebody's lunch. Only ever asked for where there is no
-- table — at a table the table IS the name.
--
-- Personal data, and the privacy notice says so. Staff-only: `orders` has no
-- anon grant, so it never reaches another diner's browser.
alter table orders add column if not exists customer_name text;

-- ── Subscription plans ──────────────────────────────────────────────────────
-- What each tier unlocks, and what it costs. Reference data, not per-tenant:
-- one row per plan, seeded here so the database is the single answer to "how
-- many tables may this restaurant have?" — the triggers that enforce the
-- limits read these same rows, so the app and the enforcement can never drift
-- apart the way they would with the numbers written into both.
--
-- A null limit means unlimited. Prices are MXN and informational: Stripe is
-- the authority on what was actually charged; these drive the plan screen.
create table if not exists plan_limits (
  plan          text primary key check (plan in ('carta', 'servicio', 'casa', 'grupo')),
  rank          int not null,              -- upgrade order, lowest first
  monthly_price numeric not null default 0,
  order_fee     numeric not null default 0, -- flat platform fee per CARD order
  max_tables    int,
  max_staff     int,                        -- excludes the founding owner
  max_menus     int,
  max_items     int,
  allows_dine_in         boolean not null default false,
  allows_promotions      boolean not null default false,
  allows_coupons         boolean not null default false,
  allows_staff_discounts boolean not null default false,
  analytics_days int not null default 1,
  log_days       int not null default 1
);

-- Seeded with on-conflict-update so re-running this script revises prices and
-- limits in place rather than skipping them.
insert into plan_limits (
  plan, rank, monthly_price, order_fee,
  max_tables, max_staff, max_menus, max_items,
  allows_dine_in, allows_promotions, allows_coupons, allows_staff_discounts,
  analytics_days, log_days
) values
  -- Counter and to-go: one QR for the whole place, no tables. Free, because
  -- it costs us almost nothing and it is how a restaurant tries us.
  ('carta',    0,    0, 3.00,    0,    2,    1,   30, false, false, false, false,   1,   1),
  -- Dine-in: tables, open bills, pay later, call the waiter. The value moment.
  ('servicio', 1,  699, 1.50,   25,   10,    3, null,  true,  true, false, false,  30,  30),
  ('casa',     2, 1499, 0.75, null, null, null, null,  true,  true,  true,  true, 365, 365),
  ('grupo',    3, 3499, 0.00, null, null, null, null,  true,  true,  true,  true, 365, 365)
on conflict (plan) do update set
  rank                   = excluded.rank,
  monthly_price          = excluded.monthly_price,
  order_fee              = excluded.order_fee,
  max_tables             = excluded.max_tables,
  max_staff              = excluded.max_staff,
  max_menus              = excluded.max_menus,
  max_items              = excluded.max_items,
  allows_dine_in         = excluded.allows_dine_in,
  allows_promotions      = excluded.allows_promotions,
  allows_coupons         = excluded.allows_coupons,
  allows_staff_discounts = excluded.allows_staff_discounts,
  analytics_days         = excluded.analytics_days,
  log_days               = excluded.log_days;

-- ── Inventory, on the paid tiers ────────────────────────────────────────────
-- Counting stock is the difference between a menu and a kitchen that knows what
-- it has, and it is the kind of thing a restaurant only wants once it is busy
-- enough to run out — which is the same point it outgrows the free tier.
--
-- Added after the tiers were seeded, so it needs its own backfill: `default
-- false` gives every existing row the free tier's answer, and the update below
-- turns it on wherever it belongs.
alter table plan_limits add column if not exists allows_inventory
  boolean not null default false;
update plan_limits set allows_inventory = true where plan in ('servicio', 'casa', 'grupo');

alter table plan_limits enable row level security;

-- Every signed-in user may read the tiers: the plan screen shows what the next
-- one costs, and a locked feature has to name its price. There is no write
-- policy on purpose — plans change by deploying this file, never through the
-- app.
drop policy if exists "plans are readable by the team" on plan_limits;
create policy "plans are readable by the team"
  on plan_limits for select using (true);

grant select on plan_limits to authenticated;
-- The customer's menu has no business knowing what the restaurant pays us.
-- The blanket anon lockdown near the top of this file ran before this table
-- existed (the same trap rate_limits, coupons and dish_ratings hit).
revoke all on plan_limits from anon;

-- Which plan a restaurant is on, and whether its billing is healthy.
--
-- Added nullable and backfilled so the restaurants that existed before plans
-- did keep everything they already had — waking an owner up locked out of
-- tables they were using yesterday is not a migration, it is an outage. New
-- signups take the default instead. Re-running finds no nulls and does nothing.
alter table restaurants add column if not exists plan text;
update restaurants set plan = 'casa' where plan is null;
alter table restaurants alter column plan set default 'carta';
alter table restaurants alter column plan set not null;

do $$ begin
  alter table restaurants
    add constraint restaurants_plan_fkey foreign key (plan) references plan_limits(plan);
exception when duplicate_object then null;
end $$;

-- trialing → active → past_due → locked. `locked` freezes the DASHBOARD only:
-- the diner's menu keeps serving and keeps taking orders, because a card that
-- bounced on Friday must not close the restaurant on Saturday.
alter table restaurants add column if not exists plan_status text;
update restaurants set plan_status = 'active' where plan_status is null;
alter table restaurants alter column plan_status set default 'trialing';
alter table restaurants alter column plan_status set not null;

do $$ begin
  alter table restaurants add constraint restaurants_plan_status_check
    check (plan_status in ('trialing', 'active', 'past_due', 'locked'));
exception when duplicate_object then null;
end $$;

alter table restaurants add column if not exists trial_ends_at timestamptz;
-- Stripe Billing's side of the relationship. Server-only, like the Connect
-- account above it: the anon lockdown covers the whole row.
alter table restaurants add column if not exists stripe_customer_id text;
alter table restaurants add column if not exists stripe_subscription_id text;

-- ── Plan limits, enforced where the rows are written ────────────────────────
-- Tables, menus and dishes are inserted by the dashboard's own Supabase client
-- rather than through an API route, so there is no server handler to check a
-- ceiling inside. A trigger is the stronger place regardless: it fires on the
-- browser's write AND on the secret key's, which bypasses RLS entirely.

-- The ceiling for one restaurant, or null for unlimited. security definer so
-- it can read plan_limits, which the dashboard's role cannot write and the
-- customer's cannot see at all.
create or replace function public.plan_ceiling(p_restaurant_id uuid, p_what text)
returns int language sql stable security definer set search_path = public as $$
  select case p_what
           when 'tables' then l.max_tables
           when 'menus'  then l.max_menus
           when 'items'  then l.max_items
           when 'staff'  then l.max_staff
         end
    from restaurants r
    join plan_limits l on l.plan = r.plan
   where r.id = p_restaurant_id;
$$;
revoke all on function public.plan_ceiling(uuid, text) from public, anon;
grant execute on function public.plan_ceiling(uuid, text) to authenticated, service_role;

-- One guard for all three, told by its trigger argument which thing it is
-- counting. The message is a parseable sentinel rather than a sentence:
-- Postgres has no idea what language the owner reads, so the dashboard turns
-- `tt_plan_limit tables servicio 25` into "Tu plan Servicio incluye 25 mesas".
create or replace function public.enforce_plan_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_what text := tg_argv[0];
  v_plan text;
  v_max  int;
  v_used bigint;
begin
  select r.plan, public.plan_ceiling(r.id, v_what)
    into v_plan, v_max
    from restaurants r
   where r.id = new.restaurant_id;

  if v_max is null then return new; end if;  -- unlimited, or no such restaurant

  if v_what = 'tables' then
    select count(*) into v_used from restaurant_tables where restaurant_id = new.restaurant_id;
  elsif v_what = 'menus' then
    select count(*) into v_used from menus where restaurant_id = new.restaurant_id;
  else
    -- "30 dishes" means dishes. An add-on rides along with the product that
    -- offers it and is not what an owner is counting when they read the limit.
    if new.is_addon then return new; end if;
    select count(*) into v_used
      from menu_items
     where restaurant_id = new.restaurant_id and not is_addon;
  end if;

  if v_used >= v_max then
    raise exception 'tt_plan_limit % % %', v_what, v_plan, v_max
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists tables_plan_limit on restaurant_tables;
create trigger tables_plan_limit before insert on restaurant_tables
  for each row execute function public.enforce_plan_limit('tables');

drop trigger if exists menus_plan_limit on menus;
create trigger menus_plan_limit before insert on menus
  for each row execute function public.enforce_plan_limit('menus');

drop trigger if exists items_plan_limit on menu_items;
create trigger items_plan_limit before insert on menu_items
  for each row execute function public.enforce_plan_limit('items');

-- A real Stripe Price for a tier, once one exists. Left null, checkout builds
-- the line item from monthly_price instead — which means subscriptions work
-- with no manual setup in the Stripe dashboard, and a proper catalogue can be
-- adopted later by filling this in without touching any code.
alter table plan_limits add column if not exists stripe_price_id text;

-- ── Launch pricing, tighter ceilings, and a ceiling on our own fee ──────────
-- `monthly_price` is what a restaurant pays today; `list_price` is what the
-- plan will cost when the launch offer ends. Shown struck through beside it,
-- so nobody discovers later that the price they signed up at was temporary.
alter table plan_limits add column if not exists list_price numeric;

-- The most we take in per-order fees in one month. Flat and small stops being
-- either on a busy month: a café doing 900 orders would pay more in fees than
-- in subscription, and a bill that big is one nobody agreed to. With a ceiling
-- the whole thing fits in a sentence — "MX$699, y nunca más de MX$1,749".
--
-- Set so it bites on an exceptional month rather than on a normal one. At 600
-- it was reached by 400 orders — thirteen a day, which nearly every working
-- restaurant passes — so the ceiling was the usual state rather than a safety
-- net, and it gave away most of the fee on every busy account. Servicio now
-- reaches it at 700 orders and Casa at 1,200.
alter table plan_limits add column if not exists fee_cap numeric;

-- 25 tables covered nearly every full-service restaurant in Mexico, so nobody
-- ever outgrew Servicio and the ladder had no rungs. A café is under 15; a
-- restaurant is 20–40 and lands on Casa; past 50 is more than one dining room,
-- which is the Grupo conversation.
update plan_limits set
  list_price = 0,    fee_cap = null                   where plan = 'carta';
update plan_limits set
  max_tables = 15,   list_price = 899,  fee_cap = 1050 where plan = 'servicio';
update plan_limits set
  max_tables = 50,   list_price = 1899, fee_cap = 900  where plan = 'casa';
update plan_limits set
  list_price = null, fee_cap = 0                      where plan = 'grupo';

-- Menu scheduling is the cleanest signal of a bigger operation in the product:
-- one menu never misses it, and desayunos / comida corrida / cena feels it
-- every day. It moves to Casa with the rest of the growth tools.
alter table plan_limits add column if not exists allows_menu_schedules boolean not null default false;
update plan_limits set allows_menu_schedules = (rank >= 2);

-- Letting food leave before it is paid for — at the end at a table, or at the
-- till on the general QR — belongs to a paid plan, and not out of greed: Carta
-- is free because we are paid by the commission on each card order, and an
-- order settled later in cash leaves none. Giving away both at once would be
-- giving away the whole product.
--
-- It was called `allows_counter_payment` when it only opened the general QR's
-- till. It now opens both halves of one permission, so it is named after what
-- it does. The value is derived from the tier, so there is nothing to migrate:
-- it is recomputed on the fly.
alter table plan_limits add column if not exists allows_deferred_payment boolean not null default false;
alter table plan_limits drop column if exists allows_counter_payment;
update plan_limits set allows_deferred_payment = (rank >= 1);

-- And on the restaurant's side, the two switches become one.
-- `allow_counter_payment` was the same permission counted separately, which is
-- how they came to contradict each other. Anyone with either one on wanted
-- their food to be able to leave before it was paid for, so that is what they
-- keep.
--
-- Wrapped in a block because the column is no longer created above: on a fresh
-- database it does not exist, and the `update` that reads it would fail.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'restaurants'
      and column_name = 'allow_counter_payment'
  ) then
    update restaurants set allow_pay_later = true where allow_counter_payment;
    alter table restaurants drop column allow_counter_payment;
  end if;
end $$;

-- What we actually took from an order, recorded on the order itself. Needed to
-- honour the monthly ceiling — the alternative is asking Stripe to add up its
-- application fees on every checkout, which is a network call in the middle of
-- a payment. It is also the row an owner's invoice is reconciled against.
alter table orders add column if not exists platform_fee numeric not null default 0;
create index if not exists orders_platform_fee_idx
  on orders(restaurant_id, created_at desc) where platform_fee > 0;

-- When a cancelled subscription actually runs out. Null means it is not
-- cancelled: the plan screen reads this to say "termina el 3 de septiembre"
-- without another round trip to Stripe on every render.
alter table restaurants add column if not exists plan_ends_at timestamptz;

-- ── Terms of service ───────────────────────────────────────────────────────
-- Which version of the terms the owner accepted, and when. Versioned rather
-- than a boolean: terms change, and "they agreed" is only worth anything if we
-- can say what they agreed to. Recorded against the restaurant because that is
-- who the contract is with — the owner signs on its behalf.
alter table restaurants add column if not exists terms_version text;
alter table restaurants add column if not exists terms_accepted_at timestamptz;
alter table restaurants add column if not exists terms_accepted_email text;

-- Everything that existed before the terms did has not accepted anything, and
-- must be asked on the next visit. Left null on purpose: pretending otherwise
-- would be recording consent nobody gave.

-- Counts on the dashboard tabs. On by default: a restaurant that has never
-- thought about it should still be told an approval is waiting. Owner and
-- manager can turn them off for everybody — the floor does not get to decide
-- it would rather not be told.
alter table restaurants add column if not exists badges_enabled boolean not null default true;

-- ── Founding price ─────────────────────────────────────────────────────────
-- The first restaurants to take a paid plan keep the price they came in at,
-- for as long as they stay on that plan.
--
-- It is the honest alternative to a struck-through price nobody ever pays:
-- once the places run out, the list price really is what later arrivals pay,
-- and the struck-through number stops being decoration.
--
-- The number is also the receipt for that promise: it is written down who is a
-- founder and in what order they arrived.
alter table restaurants add column if not exists founding_number int;
-- What this restaurant actually pays each month, as it stands in Stripe.
-- Without it the Plan screen would show the catalogue's base price, and would
-- tell anyone who subscribed after a price rise that they pay less than we
-- charge them.
alter table restaurants add column if not exists subscribed_price numeric;
create unique index if not exists restaurants_founding_number_idx
  on restaurants(founding_number) where founding_number is not null;

-- Takes the next founding place, if any are left.
--
-- The advisory lock serialises the assignment: two restaurants subscribing in
-- the same second would compute the same number, and one would be left out
-- with a place still free. It is released when the transaction ends.
create or replace function public.claim_founding_price(p_restaurant uuid, p_limit int)
returns int language plpgsql security definer set search_path = public as $$
declare v_next int;
begin
  -- Already a founder: they keep their number, whatever happens.
  select founding_number into v_next from restaurants where id = p_restaurant;
  if v_next is not null then return v_next; end if;

  perform pg_advisory_xact_lock(hashtext('tabletap:founding'));

  select coalesce(max(founding_number), 0) + 1 into v_next from restaurants;
  if v_next > p_limit then return null; end if;

  update restaurants set founding_number = v_next
   where id = p_restaurant and founding_number is null;
  return v_next;
end; $$;
revoke all on function public.claim_founding_price(uuid, int)
  from public, anon, authenticated;
grant execute on function public.claim_founding_price(uuid, int) to service_role;

-- ── Table sessions ─────────────────────────────────────────────────────────
-- A sitting: one party at one table, from their first order until the table
-- is clear again.
--
-- Before this, "what does this table owe" was answered with a time window, and
-- a window is a guess. It let the floor see a debt the diner could not pay,
-- and it had no way to tell one party from the next beyond how long ago they
-- ordered. A session is the actual thing everyone means: it opens when
-- somebody orders at an empty table, and closes when nothing is owed on it.
--
-- It is also what binds a diner to a table. A phone that has ordered carries
-- its session, so walking to another table and starting again is refused
-- while the first one is still owed for.
create table if not exists table_sessions (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  table_id      uuid not null references restaurant_tables(id) on delete cascade,
  opened_at     timestamptz not null default now(),
  closed_at     timestamptz,
  -- Paid by the diners, settled by the floor, cancelled as a loss, or simply
  -- outlived the longest sitting anybody has.
  close_reason  text check (close_reason in ('paid', 'settled', 'written_off', 'expired'))
);
-- One open sitting per table, enforced by the database rather than by whoever
-- got there first: two diners ordering at the same moment must land in the
-- same session or they cannot see each other's food on the bill.
create unique index if not exists table_sessions_one_open
  on table_sessions(table_id) where closed_at is null;
create index if not exists table_sessions_table_idx
  on table_sessions(restaurant_id, table_id, opened_at desc);
alter table table_sessions enable row level security;
drop policy if exists "team reads table sessions" on table_sessions;
create policy "team reads table sessions"
  on table_sessions for select
  using (works_at(restaurant_id));
-- Customers never read this table; the server answers for them through
-- /api/session, which tells a phone only about its own sitting.
revoke all on table_sessions from anon;

alter table orders add column if not exists session_id uuid
  references table_sessions(id) on delete set null;
create index if not exists orders_session_idx on orders(session_id);

-- Opens the table's sitting, or joins the one already open.
--
-- Security definer for the same reason redeem_coupon is: the customer's key
-- cannot touch this table, and the decision has to be atomic. The unique index
-- above is what makes the race safe — the loser of an insert re-reads the
-- winner's row instead of failing.
create or replace function public.open_table_session(
  p_restaurant uuid,
  p_table uuid,
  p_max_hours int
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  -- A sitting nobody closed is not a sitting any more. Expiring it here means
  -- the next party gets a clean table without anybody remembering to do it.
  update table_sessions
     set closed_at = now(), close_reason = 'expired'
   where table_id = p_table
     and restaurant_id = p_restaurant
     and closed_at is null
     and opened_at < now() - make_interval(hours => p_max_hours);

  -- Scoped to the restaurant: a table only seats people inside the venue it
  -- belongs to, so another venue's table id cannot slip into anybody's.
  select id into v_id
    from table_sessions
   where table_id = p_table and restaurant_id = p_restaurant and closed_at is null
   limit 1;

  if v_id is null then
    insert into table_sessions (restaurant_id, table_id)
    values (p_restaurant, p_table)
    on conflict do nothing
    returning id into v_id;

    if v_id is null then
      select id into v_id
        from table_sessions
       where table_id = p_table and restaurant_id = p_restaurant and closed_at is null
       limit 1;
    end if;
  end if;

  return v_id;
end; $$;
revoke all on function public.open_table_session(uuid, uuid, int)
  from public, anon, authenticated;
grant execute on function public.open_table_session(uuid, uuid, int) to service_role;

-- Closes a sitting once nothing on it is owed. Called after every way money
-- stops being outstanding: a card, cash at the table, or a debt written off.
create or replace function public.close_session_if_clear(
  p_session uuid,
  p_reason text
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_owing int;
begin
  select count(*) into v_owing
    from orders
   where session_id = p_session
     and paid = false
     and written_off = false
     and status <> 'cancelled'
     and status <> 'pending_payment';

  if v_owing > 0 then
    return false;
  end if;

  update table_sessions
     set closed_at = now(), close_reason = p_reason
   where id = p_session and closed_at is null;
  return true;
end; $$;
revoke all on function public.close_session_if_clear(uuid, text)
  from public, anon, authenticated;
grant execute on function public.close_session_if_clear(uuid, text) to service_role;

-- Orders that predate sittings still have to belong to one, or a debt already
-- on the floor becomes invisible to the diner who owes it. Idempotent: it only
-- touches orders with no session, and only tables with no open sitting.
insert into table_sessions (restaurant_id, table_id, opened_at)
select o.restaurant_id, o.table_id, min(o.created_at)
  from orders o
 where o.session_id is null
   and o.table_id is not null
   and o.paid = false
   and o.written_off = false
   and o.status not in ('cancelled', 'pending_payment')
   and not exists (
     select 1 from table_sessions s
      where s.table_id = o.table_id and s.closed_at is null
   )
 group by o.restaurant_id, o.table_id
on conflict do nothing;

update orders o
   set session_id = s.id
  from table_sessions s
 where o.session_id is null
   and o.table_id = s.table_id
   and s.closed_at is null
   and o.paid = false
   and o.written_off = false
   and o.status not in ('cancelled', 'pending_payment');

-- ── Cancelling a debt ──────────────────────────────────────────────────────
-- A table that leaves without paying still has orders attached to it, and
-- somebody has to say so on the record. Writing the debt off is the act; the
-- reason is what makes it auditable a month later, when "why is Tuesday short
-- MX$840?" is the actual question.
alter table orders add column if not exists write_off_reason text;
alter table orders add column if not exists write_off_note text;
alter table orders add column if not exists written_off_by text;
alter table orders add column if not exists written_off_at timestamptz;

-- A waiter may ask to cancel a bill but not grant it — erasing a debt is the
-- one floor action with no upper bound on what it costs the owner. Same shape
-- as discount_requests, for the same reason: the ask is recorded where it
-- happened, and the decision stays with whoever answers for it.
create table if not exists write_off_requests (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  table_id      uuid references restaurant_tables(id) on delete set null,
  table_label   text,
  order_ids     uuid[] not null,
  amount        numeric not null default 0,
  reason        text not null,
  note          text,                              -- what the requester said
  requested_by  text not null,
  status        text not null default 'pending'
                check (status in ('pending', 'approved', 'rejected')),
  decided_by    text,
  decided_note  text,                              -- why it was refused, if it was
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);
create index if not exists write_off_requests_open_idx
  on write_off_requests(restaurant_id, status, created_at desc);
alter table write_off_requests enable row level security;
drop policy if exists "team handles write off requests" on write_off_requests;
create policy "team handles write off requests"
  on write_off_requests for all
  using (has_role(restaurant_id, array['owner', 'manager', 'waiter', 'cashier']))
  with check (has_role(restaurant_id, array['owner', 'manager', 'waiter', 'cashier']));
-- Never a customer's business: it names staff and what a table did not pay.
revoke all on write_off_requests from anon;

-- ── Emailed receipts ───────────────────────────────────────────────────────
-- Only that one was sent, never to whom. The address a diner types is used for
-- that single message and then dropped: order rows are kept for years as the
-- restaurant's accounting record, and an address sitting beside one would
-- outlive its purpose by about that much. Nothing here is personal data.
alter table orders add column if not exists receipt_sent_at timestamptz;
-- Held addresses briefly during development; never populated in production.
alter table orders drop column if exists receipt_email;
-- Never readable with the publishable key: orders carry no anon grant at all,
-- so nothing here reaches a browser. Only the server, which sends the mail.

-- ── Inventory ───────────────────────────────────────────────────────────────
-- How many are left, when the restaurant wants us to count.
--
-- Null means untracked, and untracked is the default: `available` stays the
-- manual switch it has always been, and a restaurant that never opens this
-- feature sees no change at all. A number turns the switch automatic — the
-- count falls as orders are placed, and the dish takes itself off the menu at
-- zero. The two are deliberately not merged: a kitchen that has run out of gas
-- still needs to pull a dish that it has plenty of stock for.
alter table menu_items add column if not exists stock int;
alter table menu_items drop constraint if exists menu_items_stock_check;
alter table menu_items add constraint menu_items_stock_check
  check (stock is null or stock >= 0);

-- When to warn the people who can do something about it. Off by default,
-- because a restaurant that has not set any counts would only get noise.
alter table restaurants add column if not exists low_stock_alerts_enabled
  boolean not null default false;
alter table restaurants add column if not exists low_stock_threshold
  int not null default 5;
alter table restaurants drop constraint if exists restaurants_low_stock_threshold_check;
alter table restaurants add constraint restaurants_low_stock_threshold_check
  check (low_stock_threshold >= 0 and low_stock_threshold <= 999);

-- ── Notifications ───────────────────────────────────────────────────────────
-- What the bell in the nav shows.
--
-- The text is NOT stored. A restaurant reads the dashboard in Spanish or in
-- English and can change that at any moment, so a row keeps the `kind` and the
-- facts (`data`), and the screen renders the sentence in whichever language is
-- being read. Storing the sentence would freeze it in the language it happened
-- to be written in.
--
-- Read is a timestamp rather than a flag because the requirement is that a
-- read notification stays in the list: nothing here is ever deleted on being
-- read, it only stops counting towards the unread total.
create table if not exists notifications (
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('low_stock', 'out_of_stock')),
  data       jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

-- The bell asks for the newest ten for one restaurant, on every poll. Without
-- this that is a scan of every notification on the platform.
create index if not exists notifications_recent_idx
  on notifications(restaurant_id, created_at desc);

alter table notifications enable row level security;

-- Owner and manager only — has_role() already answers true for the founding
-- owner. The floor and the kitchen cannot act on a stock warning and do not
-- get told about one.
drop policy if exists "managers read notifications" on notifications;
create policy "managers read notifications"
  on notifications for select
  using (has_role(restaurant_id, array['manager']));

-- Marking one read is the only write a browser may make. There is no insert
-- policy on purpose: notifications are raised server-side with the secret key,
-- so nothing can forge one.
drop policy if exists "managers mark notifications read" on notifications;
create policy "managers mark notifications read"
  on notifications for update
  using (has_role(restaurant_id, array['manager']))
  with check (has_role(restaurant_id, array['manager']));

revoke all on notifications from anon;
grant select (restaurant_id, id, kind, data, read_at, created_at) on notifications to authenticated;
grant update (read_at) on notifications to authenticated;

-- Which dishes the system took off the menu itself, so that giving the stock
-- back can put them back. Without it, an abandoned checkout that emptied the
-- last unit would return the count and leave the dish hidden, and the only
-- clue would be a number that disagreed with the switch beside it.
alter table menu_items add column if not exists stock_auto_off boolean not null default false;

-- Take the stock an order needs, atomically.
--
-- `p_demand` is [{"item_id": uuid, "qty": int}, …], already summed per dish by
-- the caller — one cart can list the same dish on several lines, and each
-- component of a combo eats from its own count.
--
-- All or nothing: if any dish is short, nothing is taken and the shortfall
-- comes back so the diner can be told what is actually left. The rows are
-- locked in id order, which is what stops two diners at different tables from
-- both getting the last portion, and what stops two carts holding overlapping
-- dishes from deadlocking against each other.
--
-- Dishes with a null count are not tracked and are skipped entirely.
--
-- `low` reports only the dishes this order pushed ACROSS the threshold, not
-- every dish already under it — otherwise every subsequent order would raise
-- the same warning again until someone restocked, and a bell that repeats
-- itself is a bell people stop reading.
create or replace function public.reserve_stock(
  p_restaurant uuid,
  p_demand     jsonb,
  p_threshold  int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_short jsonb := '[]'::jsonb;
  v_low   jsonb := '[]'::jsonb;
  v_row   record;
begin
  -- Lock every tracked row this cart touches, in a deterministic order.
  for v_row in
    select m.id, m.name, m.stock, m.available, (d.qty)::int as want
      from jsonb_to_recordset(p_demand) as d(item_id uuid, qty int)
      join menu_items m on m.id = d.item_id
     where m.restaurant_id = p_restaurant
       and m.stock is not null
     order by m.id
       for update of m
  loop
    if v_row.stock < v_row.want then
      v_short := v_short || jsonb_build_object(
        'item_id', v_row.id, 'name', v_row.name, 'available', v_row.stock);
    end if;
  end loop;

  if jsonb_array_length(v_short) > 0 then
    return jsonb_build_object('ok', false, 'short', v_short, 'low', '[]'::jsonb);
  end if;

  -- Nothing was short, so take it all. A dish that reaches zero takes itself
  -- off the menu, and remembers that it was us who did it.
  for v_row in
    select m.id, m.name, m.stock, (d.qty)::int as want
      from jsonb_to_recordset(p_demand) as d(item_id uuid, qty int)
      join menu_items m on m.id = d.item_id
     where m.restaurant_id = p_restaurant
       and m.stock is not null
     order by m.id
  loop
    update menu_items
       set stock          = v_row.stock - v_row.want,
           available      = case when v_row.stock - v_row.want = 0 then false else available end,
           stock_auto_off = case when v_row.stock - v_row.want = 0 then true  else stock_auto_off end
     where id = v_row.id;

    if v_row.stock - v_row.want = 0 then
      v_low := v_low || jsonb_build_object(
        'item_id', v_row.id, 'name', v_row.name, 'stock', 0, 'kind', 'out_of_stock');
    elsif v_row.stock > p_threshold and v_row.stock - v_row.want <= p_threshold then
      v_low := v_low || jsonb_build_object(
        'item_id', v_row.id, 'name', v_row.name,
        'stock', v_row.stock - v_row.want, 'kind', 'low_stock');
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'short', '[]'::jsonb, 'low', v_low);
end;
$$;
revoke all on function public.reserve_stock(uuid, jsonb, int) from public, anon, authenticated;
grant execute on function public.reserve_stock(uuid, jsonb, int) to service_role;

-- Give stock back when the checkout it was taken for never completed, or when
-- a placed order is cancelled. A dish the system hid at zero comes back on the
-- menu; one the restaurant switched off by hand stays off, because that switch
-- was somebody's decision and not ours to undo.
create or replace function public.release_stock(p_restaurant uuid, p_demand jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update menu_items m
     set stock          = m.stock + d.qty,
         available      = case when m.stock = 0 and m.stock_auto_off then true  else m.available end,
         stock_auto_off = case when m.stock = 0 and m.stock_auto_off then false else m.stock_auto_off end
    from jsonb_to_recordset(p_demand) as d(item_id uuid, qty int)
   where m.id = d.item_id
     and m.restaurant_id = p_restaurant
     and m.stock is not null;
end;
$$;
revoke all on function public.release_stock(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.release_stock(uuid, jsonb) to service_role;

-- `stock` rides along on the anon grant that menu_items already had, and that
-- is deliberate. The customer page selects `*`, so a column-list grant would
-- have to name every column or the menu stops loading — and the count is not a
-- secret we are keeping from diners in the first place: the checkout tells
-- them "only 5 left" the moment they ask for six. Kept in one place so the next
-- reader knows it was weighed rather than missed.

-- ── Money received ──────────────────────────────────────────────────────────
-- What was actually paid, as opposed to which orders are settled.
--
-- `orders.paid` is a boolean, so the only thing the system could say was "this
-- order is done". That is enough while a payment always covers whole orders,
-- and it stops being enough the moment a table divides a bill: paying a third
-- of MX$100 across orders of MX$60 and MX$40 is an amount that belongs to no
-- order at all.
--
-- Every row here is money that arrived. `order_id` says which order it settled
-- when it settled one; a share of a divided bill will carry a session and no
-- order. Nothing is deleted — a refund is its own negative-sense record, never
-- an edit of the row that says money came in.
create table if not exists payments (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  -- Kept when the order or the sitting is removed: the money still happened.
  order_id      uuid references orders(id) on delete set null,
  session_id    uuid references table_sessions(id) on delete set null,
  amount        numeric not null check (amount > 0),
  method        text not null check (method in ('card', 'cash')),
  stripe_payment_intent text,
  -- Who took it. Null when the diner paid online and nobody was holding a till.
  actor_email   text,
  created_at    timestamptz not null default now()
);
create index if not exists payments_restaurant_idx
  on payments(restaurant_id, created_at desc);
create index if not exists payments_order_idx on payments(order_id);
create index if not exists payments_session_idx on payments(session_id);

alter table payments enable row level security;

-- The whole team reads them: a cashier's own takings and the day's count are
-- both built from this. Nobody writes from a browser — money is recorded by
-- the routes that took it, with the secret key.
drop policy if exists "team reads payments" on payments;
create policy "team reads payments"
  on payments for select using (works_at(restaurant_id));

revoke all on payments from anon;
grant select on payments to authenticated;

-- Backfill: one payment for every order already settled, so the ledger agrees
-- with the boolean from its first day. Idempotent, because this file re-runs —
-- an order that already has a payment is skipped rather than doubled.
insert into payments (restaurant_id, order_id, session_id, amount, method, created_at)
select o.restaurant_id, o.id, o.session_id, o.total,
       case when coalesce(o.pay_method, '') = 'cash' then 'cash' else 'card' end,
       o.created_at
  from orders o
 where o.paid
   and o.total > 0
   and not exists (select 1 from payments p where p.order_id = o.id);
