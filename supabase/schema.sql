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
  currency    text not null default 'USD',
  service_pct numeric not null default 0,        -- service charge %, e.g. 10
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
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

-- Migration for databases created before is_addon existed.
alter table menu_items add column if not exists is_addon boolean not null default false;

-- Migration for databases created before menus existed.
alter table categories add column if not exists menu_id uuid references menus(id) on delete cascade;
alter table menu_items add column if not exists menu_id uuid references menus(id) on delete cascade;

-- ── Item add-ons ────────────────────────────────────────────────────────────
-- Many-to-many: which add-on items can be added to which product.
-- Both sides are menu_items; the add-on side has is_addon = true.
create table if not exists item_addons (
  product_id uuid not null references menu_items(id) on delete cascade,
  addon_id   uuid not null references menu_items(id) on delete cascade,
  sort_order int not null default 0,
  primary key (product_id, addon_id)
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
  total         numeric not null default 0,
  currency      text not null default 'USD',
  -- line items snapshot: [{ name, emoji, price, qty, mods: {}, notes }]
  items         jsonb not null default '[]'::jsonb,
  note          text,                            -- whole-order note
  pay_method    text,                            -- 'card' | 'apple' | 'google' | 'paypal'
  stripe_session_id text,
  stripe_payment_intent text,
  paid          boolean not null default false,
  created_at    timestamptz not null default now()
);

-- short human-friendly code for display (ORD-XXXX) derived from id
create index if not exists orders_restaurant_idx on orders(restaurant_id, created_at desc);
create index if not exists orders_status_idx on orders(restaurant_id, status);

-- ── Realtime: broadcast order changes to dashboard + customer ───────────────
do $$ begin
  alter publication supabase_realtime add table orders;
exception when duplicate_object then null;  -- already added; safe to re-run
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

-- Column-level guard: the public (anon) role sees only a restaurant's display
-- columns — never owner_id or created_at. RLS decides which ROWS are visible;
-- this decides which COLUMNS. The dashboard (authenticated owner) and the
-- secret key keep full access.
revoke select on restaurants from anon;
grant select (id, name, tagline, logo, currency, service_pct) on restaurants to anon;
grant select on restaurants to authenticated;

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
  select exists (select 1 from restaurants r where r.id = rid and r.owner_id = auth.uid());
$$;
revoke all on function public.owns_restaurant(uuid) from public;
grant execute on function public.owns_restaurant(uuid) to anon, authenticated;

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
drop policy if exists "owner reads orders" on orders;
create policy "owner reads orders"
  on orders for select
  using (owns_restaurant(restaurant_id));

-- INSERT/UPDATE on orders is done ONLY server-side via the secret key, which
-- bypasses RLS. So we intentionally add NO insert/update policies here:
-- the publishable (client) key cannot create or mutate orders directly.

-- OWNER WRITE: the logged-in restaurant owner manages their own menu/tables.
drop policy if exists "owner manages restaurant" on restaurants;
create policy "owner manages restaurant"
  on restaurants for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "owner manages tables" on restaurant_tables;
create policy "owner manages tables"
  on restaurant_tables for all
  using (owns_restaurant(restaurant_id))
  with check (owns_restaurant(restaurant_id));

drop policy if exists "owner manages menus" on menus;
create policy "owner manages menus"
  on menus for all
  using (owns_restaurant(restaurant_id))
  with check (owns_restaurant(restaurant_id));

drop policy if exists "owner manages categories" on categories;
create policy "owner manages categories"
  on categories for all
  using (owns_restaurant(restaurant_id))
  with check (owns_restaurant(restaurant_id));

drop policy if exists "owner manages menu" on menu_items;
create policy "owner manages menu"
  on menu_items for all
  using (owns_restaurant(restaurant_id))
  with check (owns_restaurant(restaurant_id));

-- Owner manages add-on links for products in their restaurant.
drop policy if exists "owner manages item addons" on item_addons;
create policy "owner manages item addons"
  on item_addons for all
  using (owns_restaurant((select mi.restaurant_id from menu_items mi where mi.id = product_id)))
  with check (owns_restaurant((select mi.restaurant_id from menu_items mi where mi.id = product_id)));

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
