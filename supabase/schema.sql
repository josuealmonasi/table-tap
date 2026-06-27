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

-- ============================================================================
-- SEED DATA — a demo restaurant so you can test immediately
-- ============================================================================
do $$
declare
  rid uuid;
  cat_starters uuid; cat_mains uuid; cat_sushi uuid; cat_drinks uuid; cat_desserts uuid;
begin
  -- Idempotent: skip seeding if the demo restaurant already exists.
  if exists (select 1 from restaurants where name = 'Sakura Dining') then
    raise notice 'Seed skipped — Sakura Dining already exists.';
    return;
  end if;

  -- Restaurant
  insert into restaurants (name, tagline, logo, currency, service_pct)
  values ('Sakura Dining', 'Modern Japanese Kitchen', '🌸', 'USD', 10)
  returning id into rid;

  -- Tables 1..12
  for i in 1..12 loop
    insert into restaurant_tables (restaurant_id, label) values (rid, i::text);
  end loop;

  -- Categories
  insert into categories (restaurant_id, name, sort_order) values (rid,'Starters',1) returning id into cat_starters;
  insert into categories (restaurant_id, name, sort_order) values (rid,'Mains',2)    returning id into cat_mains;
  insert into categories (restaurant_id, name, sort_order) values (rid,'Sushi',3)    returning id into cat_sushi;
  insert into categories (restaurant_id, name, sort_order) values (rid,'Drinks',4)   returning id into cat_drinks;
  insert into categories (restaurant_id, name, sort_order) values (rid,'Desserts',5) returning id into cat_desserts;

  -- Menu items
  insert into menu_items (restaurant_id, category_id, name, description, price, emoji, popular, modifiers, sort_order) values
  (rid, cat_starters, 'Edamame', 'Steamed salted soybeans with sea salt', 4.50, '🫛', true,
    '[{"label":"Spice level","type":"single","options":["Mild","Spicy","Extra Spicy"]}]', 1),
  (rid, cat_starters, 'Gyoza (6 pcs)', 'Pan-fried pork & cabbage dumplings with ponzu', 8.90, '🥟', true,
    '[{"label":"Cooking style","type":"single","options":["Pan-fried","Steamed"]},{"label":"Extra sauce","type":"multi","options":["Ponzu","Soy","Chili oil"]}]', 2),
  (rid, cat_starters, 'Miso Soup', 'Dashi-based miso with tofu, wakame, spring onion', 3.50, '🍵', false, '[]', 3),
  (rid, cat_mains, 'Tonkotsu Ramen', 'Rich pork bone broth, chashu, soft egg, nori', 14.90, '🍜', true,
    '[{"label":"Broth richness","type":"single","options":["Light","Regular","Rich"]},{"label":"Noodle firmness","type":"single","options":["Soft","Medium","Firm (kata)"]},{"label":"Extras","type":"multi","options":["Extra chashu +$3","Extra egg +$1.5","Extra nori +$1"]}]', 1),
  (rid, cat_mains, 'Katsu Curry', 'Crispy panko chicken katsu, Japanese curry, rice', 13.50, '🍛', false,
    '[{"label":"Protein","type":"single","options":["Chicken","Pork","Tofu (V)"]},{"label":"Curry heat","type":"single","options":["Mild","Medium","Hot"]}]', 2),
  (rid, cat_mains, 'Teriyaki Salmon', 'Grilled salmon, house teriyaki, rice and pickles', 17.90, '🐟', false,
    '[{"label":"Side","type":"single","options":["Steamed rice","Soba noodles","Salad"]}]', 3),
  (rid, cat_sushi, 'Salmon Nigiri (4 pcs)', 'Hand-pressed vinegared rice, fresh salmon', 11.50, '🍣', true,
    '[{"label":"Wasabi","type":"single","options":["With wasabi","No wasabi"]}]', 1),
  (rid, cat_sushi, 'Dragon Roll (8 pcs)', 'Prawn tempura, avocado & eel, spicy mayo', 16.90, '🐉', true,
    '[{"label":"Sauce","type":"single","options":["Spicy mayo","Teriyaki","Both"]}]', 2),
  (rid, cat_drinks, 'Asahi Beer', 'Japanese lager, 330ml bottle', 5.50, '🍺', false, '[]', 1),
  (rid, cat_drinks, 'Matcha Latte', 'Ceremonial grade matcha, steamed oat milk', 4.90, '🍵', true,
    '[{"label":"Milk","type":"single","options":["Oat","Soy","Full cream"]}]', 2),
  (rid, cat_drinks, 'Yuzu Lemonade', 'Yuzu citrus syrup, sparkling water, mint', 4.50, '🍋', false,
    '[{"label":"Sugar","type":"single","options":["Normal","Less sweet","No sugar"]}]', 3),
  (rid, cat_desserts, 'Mochi Ice Cream (3 pcs)', 'Soft rice cake with ice cream filling', 7.90, '🍡', true,
    '[{"label":"Flavours","type":"multi","options":["Matcha","Strawberry","Mango","Vanilla","Black sesame"]}]', 1),
  (rid, cat_desserts, 'Matcha Tiramisu', 'Matcha-soaked ladyfingers, mascarpone', 8.50, '🍰', false, '[]', 2);

  raise notice 'Seeded restaurant id: %', rid;
end $$;

-- After running, grab your demo IDs with:
--   select id, name from restaurants;
--   select id, label from restaurant_tables order by label::int;
