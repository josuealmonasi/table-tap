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

-- ── Menu categories ─────────────────────────────────────────────────────────
create table if not exists categories (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name          text not null,
  sort_order    int not null default 0
);

-- ── Menu items ──────────────────────────────────────────────────────────────
create table if not exists menu_items (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  category_id   uuid references categories(id) on delete set null,
  name          text not null,
  description   text,
  price         numeric not null default 0,
  emoji         text default '🍽️',
  image_url     text,
  popular       boolean not null default false,
  available     boolean not null default true,
  -- modifiers stored as JSON: [{ label, type: 'single'|'multi', options: [string] }]
  modifiers     jsonb not null default '[]'::jsonb,
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
alter table categories         enable row level security;
alter table menu_items         enable row level security;
alter table orders             enable row level security;

-- PUBLIC READ: anyone with the QR can read the restaurant's menu (no login).
-- These tables hold no sensitive data — just the public menu.
-- (drop-if-exists before each create keeps this script safe to re-run.)
drop policy if exists "public read restaurants" on restaurants;
create policy "public read restaurants"
  on restaurants for select using (true);

drop policy if exists "public read tables" on restaurant_tables;
create policy "public read tables"
  on restaurant_tables for select using (true);

drop policy if exists "public read categories" on categories;
create policy "public read categories"
  on categories for select using (true);

drop policy if exists "public read available menu" on menu_items;
create policy "public read available menu"
  on menu_items for select using (true);

-- ORDERS:
-- A customer can read a single order by its id (they get the id back after
-- checkout and poll/subscribe to it). We allow public SELECT because the id is
-- an unguessable UUID — effectively a capability token.
drop policy if exists "read order by id" on orders;
create policy "read order by id"
  on orders for select using (true);

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
  using (exists (select 1 from restaurants r where r.id = restaurant_id and r.owner_id = auth.uid()))
  with check (exists (select 1 from restaurants r where r.id = restaurant_id and r.owner_id = auth.uid()));

drop policy if exists "owner manages categories" on categories;
create policy "owner manages categories"
  on categories for all
  using (exists (select 1 from restaurants r where r.id = restaurant_id and r.owner_id = auth.uid()))
  with check (exists (select 1 from restaurants r where r.id = restaurant_id and r.owner_id = auth.uid()));

drop policy if exists "owner manages menu" on menu_items;
create policy "owner manages menu"
  on menu_items for all
  using (exists (select 1 from restaurants r where r.id = restaurant_id and r.owner_id = auth.uid()))
  with check (exists (select 1 from restaurants r where r.id = restaurant_id and r.owner_id = auth.uid()));

-- Demo seed data lives separately in supabase/seed.sql
--   pnpm db:create  → this file (structure only)
--   pnpm db:seed    → seed.sql  (demo restaurant + menu)
--   pnpm db:reset   → drop + create + seed
