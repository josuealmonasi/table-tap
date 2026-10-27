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

-- May a table divide its own bill?
--
-- On by default, because it is what a table of friends expects. Off is for the
-- places where it gets in the way: a bar running one tab, a set menu, anywhere
-- the floor would rather do the arithmetic itself.
--
-- It gates the OFFER, not the maths. With no Stripe account the shares cannot
-- be charged to a card, so they are a division the table shows the waiter, who
-- collects each one on the calculator — which is most of what a table actually
-- does with a bill.
alter table restaurants add column if not exists split_enabled boolean not null default true;


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

-- What may be put in it, and how big.
--
-- The bucket had neither: any type, any size. Writes are manager-scoped, so
-- this was never a way in — but a public bucket with no allowlist serves
-- whatever is put there from the project's own domain, and an SVG or an HTML
-- file is a page, not a picture. Unbounded size is the other half: nothing
-- stopped one upload from costing more than a year of the plan.
--
-- `image/webp` and `image/jpeg`, the only things the app uploads: every photo
-- is redrawn by `preparePhoto` before it goes anywhere near storage, as WebP,
-- or as JPEG from Safari, which cannot encode WebP (it used to send a PNG
-- mislabelled as WebP). Both are pictures, never pages. 5 MB is the spec's
-- `maxBytes`, held against the RESIZED photo — a phone's original is often
-- far bigger, and is never stored.
--
-- Written every time rather than on insert: the bucket already exists in every
-- environment, so `on conflict do nothing` above would never have applied it.
update storage.buckets
   set file_size_limit = 5 * 1024 * 1024,
       allowed_mime_types = array['image/webp', 'image/jpeg']
 where id = 'menu';

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

-- The tills read a stock count off every tile, and two people sell at once. RLS
-- still decides who hears this: staff read `menu_items` under `works_at`, which
-- does not move when the stock does, while the diner's policy is `available and
-- menu active` — so a dish selling out takes the row out of their reach and the
-- event with it. That is why the customer's menu polls and the till listens.
do $$ begin
  alter publication supabase_realtime add table menu_items;
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
-- `timezone` is on the list because the menu reads it to decide which menu is
-- open at this hour. Without the grant the read failed and fell back to
-- America/Mexico_City without a word: it does not show today because every
-- restaurant is there, and the day one opens in Cancún or Tijuana its menu
-- schedules would open at the wrong hour.
grant select (id, name, tagline, logo, currency, service_pct, service_enabled, accepting_orders, tax_pct, tax_show_breakdown, cover_url, cover_enabled, logo_url, allow_pay_later, timezone, deals_tab_enabled, split_enabled) on restaurants to anon;

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
grant select (id, name, tagline, logo, currency, service_pct, service_enabled, accepting_orders, tax_pct, tax_show_breakdown, cover_url, cover_enabled, logo_url, allow_pay_later, timezone, deals_tab_enabled, split_enabled) on restaurants to authenticated;

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

-- And the team reads its own menu in full, sold-out dishes included.
--
-- The tills show every dish with the ones that have run out marked AGOTADO,
-- which the server has always fetched with the secret key. Realtime cannot: it
-- evaluates the subscriber's OWN read, so a cashier — who is not a manager and
-- so matched only the public policy above — heard nothing on the socket at all.
-- Not the decrements, and not the sell-out, which is the one event the tile
-- most needs: the count sat there reading "quedan 1" for a dish that had gone.
--
-- Nothing new reaches anybody. Every staff screen already renders these rows;
-- this makes the read direct instead of borrowed, which is what the socket
-- needs. `works_at` is the restaurant's own people and nobody else's, so the
-- cross-tenant answer does not move — `pnpm rls` checks that both ways.
drop policy if exists "team reads menu items" on menu_items;
create policy "team reads menu items"
  on menu_items for select
  using (works_at(restaurant_id));

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
  -- A window that ended more than a day ago answers nothing a limit asks, and
  -- a key kept for ever is data kept for ever: the privacy notice promises a
  -- day. Swept now and then rather than on every call — one call in fifty
  -- clears the whole table.
  if random() < 0.02 then
    delete from rate_limits where window_start < now() - interval '1 day';
  end if;
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
  using (user_id = (select auth.uid()));

-- PROFILES: each user manages only their own row; the owner can additionally
-- read their staff's profiles so the Staff page can show real names.
alter table profiles enable row level security;
drop policy if exists "own profile" on profiles;
create policy "own profile"
  on profiles for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
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
  using (has_role(restaurant_id, array['manager', 'waiter', 'cashier']));

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
  using (has_role(restaurant_id, array['manager', 'waiter', 'cashier']));
drop policy if exists "owner updates service requests" on service_requests;
drop policy if exists "team updates service requests" on service_requests;
create policy "team updates service requests"
  on service_requests for update
  using (has_role(restaurant_id, array['manager', 'waiter', 'cashier']))
  with check (has_role(restaurant_id, array['manager', 'waiter', 'cashier']) and status in ('open', 'done'));
-- Staff only ever mark a request answered, so that is the one column they may
-- write. With the whole row writable, a member of one restaurant could point
-- their own request at another restaurant's table (the policy checks the
-- request's restaurant, not its table's), and that table's diners' calls were
-- then answered "already asked" and reached nobody.
revoke update on service_requests from authenticated;
grant update (status) on service_requests to authenticated;

-- OWNER WRITE: the logged-in restaurant owner manages their own menu/tables.
-- owns_restaurant() covers co-owners (staff role 'owner') too.
drop policy if exists "owner manages restaurant" on restaurants;
create policy "owner manages restaurant"
  on restaurants for all
  using (owns_restaurant(id))
  with check (owns_restaurant(id));

-- ...and nothing a browser holds may write this table at all.
--
-- The policy above says an owner manages their own restaurant, which is true
-- and was read as though it meant the columns an owner edits. It does not: a
-- policy decides which ROWS a statement may touch, never which columns. With
-- Supabase's default table-wide grant still in place, `owns_restaurant(id)`
-- let an owner write every column of their own row from the browser console —
-- `plan` to grupo, `plan_status` to active, `trial_ends_at` to 2099, and
-- `stripe_account_id` to any account they liked. Proved by doing it, and by
-- reading the values back with the secret key afterwards.
--
-- Every legitimate write to this table already goes through the server: the
-- settings screen posts to /api/settings, billing is written by the Stripe
-- webhook, and signup and deletion use the secret key. Nothing in the app
-- loses anything by this, and the tier a restaurant is on stops being
-- something the restaurant can set.
revoke insert, update, delete on restaurants from authenticated;

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
  on discount_requests for select
  using (has_role(restaurant_id, array['owner', 'manager', 'waiter', 'cashier']));
-- Never a customer's business: the ask names staff and carries a code.
revoke all on discount_requests from anon;
-- Only guarded routes may set the target, shown amount or decision.
revoke insert, update, delete on discount_requests from authenticated;
grant select on discount_requests to authenticated;

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
returns void language sql
set search_path = public
as $$
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
returns trigger language plpgsql
set search_path = public
as $$
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
-- Subscription currency is independent of the restaurant's menu currency.
create table if not exists plan_limits (
  plan          text primary key check (plan in ('carta', 'caja', 'servicio', 'casa', 'grupo')),
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
  allows_staff_discounts boolean not null default false
);

-- Seeded with on-conflict-update so re-running this script revises prices and
-- limits in place rather than skipping them.
insert into plan_limits (
  plan, rank, monthly_price, order_fee,
  max_tables, max_staff, max_menus, max_items,
  allows_dine_in, allows_promotions, allows_coupons, allows_staff_discounts
) values
  -- Counter and to-go: one QR for the whole place, no tables. Free, because
  -- it costs us almost nothing and it is how a restaurant tries us.
  ('carta',    0,    0, 3.00,    0,    2,    1,   30, false, false, false, false),
  -- Dine-in: tables, open bills, pay later, call the waiter. The value moment.
  ('servicio', 2,  699, 1.50,   25,   10,    3, null,  true,  true, false, false),
  ('casa',     3, 1499, 0.75, null, null, null, null,  true,  true,  true,  true),
  ('grupo',    4, 3499, 0.00, null, null, null, null,  true,  true,  true,  true)
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
  allows_staff_discounts = excluded.allows_staff_discounts;

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

-- The counter till: a cashier taking an order face to face, charging cash or a
-- card on their own terminal, and sending it to the kitchen once the money is
-- in. It earns us no per-order fee — none of that money touches Stripe — so
-- the subscription is what pays for it, and it belongs to the paid tiers.
--
-- Not on `carta` even though carta is the counter tier: carta is how a
-- restaurant tries us, and this is the feature that replaces the cash register
-- they already own.
alter table plan_limits add column if not exists allows_pos
  boolean not null default false;
update plan_limits set allows_pos = true where plan in ('servicio', 'casa', 'grupo');

-- The waiter's own order screen: a table is seated, and the person standing at
-- it takes what they want.
--
-- This is the feature that decides whether a full-service restaurant can run on
-- us at all. Without it they need a second system for the oldest act in the
-- trade — somebody walks to a table and writes down an order — and given the
-- choice between two systems and one, nobody picks two.
--
-- On `servicio` and above, and deliberately at the ENTRY paid tier rather than
-- higher up. `servicio` is the tier named for service; it already carries
-- dine-in and settling at the end, which is exactly this. And `carta` has no
-- tables at all, so the gate would be meaningless there even if we wanted it.
alter table plan_limits add column if not exists allows_waiter_service
  boolean not null default false;
update plan_limits set allows_waiter_service = true
 where plan in ('servicio', 'casa', 'grupo');

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

-- Readable ONLY by the team: it is the platform's price list, shared by every
-- restaurant, and one of them editing it is not a tenancy question. Every
-- legitimate write goes through the server. This used to sit four hundred
-- lines up, with the other revokes, and ran before the table existed — so on a
-- database with the table already there nothing noticed, and building the
-- schema from nothing failed on it for two weeks.
revoke insert, update, delete on plan_limits from authenticated;

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
-- Local trial expiry is an entitlement fact even before an app request ends it.
create or replace function public.effective_restaurant_plan(p_restaurant_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when r.plan_status = 'trialing' and r.stripe_subscription_id is null
                   and r.trial_ends_at <= now() then 'carta' else r.plan end
    from restaurants r where r.id = p_restaurant_id;
$$;
revoke all on function public.effective_restaurant_plan(uuid) from public, anon, authenticated;
grant execute on function public.effective_restaurant_plan(uuid) to service_role;

create or replace function public.plan_ceiling(p_restaurant_id uuid, p_what text)
returns int language sql stable security definer set search_path = public as $$
  select case p_what
           when 'tables' then l.max_tables
           when 'menus'  then l.max_menus
           when 'items'  then l.max_items
           when 'staff'  then l.max_staff
         end
    from restaurants r
    join plan_limits l on l.plan = public.effective_restaurant_plan(r.id)
   where r.id = p_restaurant_id;
$$;
-- Nobody with a browser key, in either hand.
--
-- `anon` was already refused; `authenticated` was not, and it had no reason to
-- be allowed: nothing in the app calls this from a browser. What it did allow
-- was a kitchen hand at one restaurant asking what ANOTHER restaurant's plan
-- permits — "50 tables" is enough to read a competitor's tier off the answer.
--
-- The trigger that uses it is SECURITY DEFINER and runs as its owner, so it
-- keeps working with nobody else holding execute.
revoke all on function public.plan_ceiling(uuid, text) from public, anon, authenticated;
grant execute on function public.plan_ceiling(uuid, text) to service_role;

-- One guard for all four, told by its trigger argument which thing it is
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
  if tg_op = 'UPDATE' then
    if old.restaurant_id = new.restaurant_id then
      if v_what <> 'items' then return new; end if;
      if not old.is_addon or new.is_addon then return new; end if;
    end if;
  end if;
  -- Lock before counting, including secret-key staff invites. The weaker row
  -- lock lets foreign-key checks proceed while competing creates wait.
  -- Ordinary stock updates never need this lock and must not delay selling.
  perform 1 from restaurants where id = new.restaurant_id for no key update;
  select public.effective_restaurant_plan(r.id), public.plan_ceiling(r.id, v_what)
    into v_plan, v_max
    from restaurants r
   where r.id = new.restaurant_id;

  if v_max is null then return new; end if;  -- unlimited, or no such restaurant

  if v_what = 'tables' then
    select count(*) into v_used from restaurant_tables where restaurant_id = new.restaurant_id;
  elsif v_what = 'menus' then
    select count(*) into v_used from menus where restaurant_id = new.restaurant_id;
  elsif v_what = 'staff' then
    select count(*) into v_used from staff where restaurant_id = new.restaurant_id;
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

-- The trigger functions are not an API. PostgREST will not expose one anyway —
-- it has no trigger context to call it with — but the grant said otherwise, and
-- said it inconsistently: every other trigger function here is service_role
-- only. After the function, not before it: above its own definition this
-- revoke broke building the schema from nothing.
revoke all on function public.enforce_plan_limit() from public, anon, authenticated;

drop trigger if exists tables_plan_limit on restaurant_tables;
create trigger tables_plan_limit before insert or update on restaurant_tables
  for each row execute function public.enforce_plan_limit('tables');

drop trigger if exists menus_plan_limit on menus;
create trigger menus_plan_limit before insert or update on menus
  for each row execute function public.enforce_plan_limit('menus');

drop trigger if exists items_plan_limit on menu_items;
create trigger items_plan_limit before insert or update on menu_items
  for each row execute function public.enforce_plan_limit('items');

drop trigger if exists staff_plan_limit on staff;
create trigger staff_plan_limit before insert or update on staff
  for each row execute function public.enforce_plan_limit('staff');
grant execute on function public.enforce_plan_limit() to service_role;

-- RLS still decides whose row may be edited. This extra guard freezes only
-- authenticated management writes, never server stock, kitchen or settlement.
create or replace function public.enforce_dashboard_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op <> 'INSERT' then
    if exists (select 1 from restaurants where id = old.restaurant_id and plan_status = 'locked') then
      raise exception 'tt_plan_frozen' using errcode = 'check_violation';
    end if;
  end if;
  if tg_op <> 'DELETE' then
    if exists (select 1 from restaurants where id = new.restaurant_id and plan_status = 'locked') then
      raise exception 'tt_plan_frozen' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  return old;
end $$;
revoke all on function public.enforce_dashboard_write() from public, anon, authenticated;
grant execute on function public.enforce_dashboard_write() to service_role;

drop trigger if exists menus_dashboard_write on menus;
create trigger menus_dashboard_write before insert or update or delete on menus
  for each row execute function public.enforce_dashboard_write();
drop trigger if exists items_dashboard_write on menu_items;
create trigger items_dashboard_write before insert or update or delete on menu_items
  for each row execute function public.enforce_dashboard_write();
drop trigger if exists tables_dashboard_write on restaurant_tables;
create trigger tables_dashboard_write before insert or update or delete on restaurant_tables
  for each row execute function public.enforce_dashboard_write();

-- A paid feature has to be paid for in the database too.
--
-- Five of the eight tiered features are refused by an API route. Three are not,
-- because the menu editor writes them straight to Postgres with the browser's
-- own key: counting stock and scheduling a menu were hidden by the screen and
-- allowed by the row. A restaurant on the free tier could set either by
-- calling Supabase directly, which is the UI enforcing the price list and the
-- database not.
--
-- Two things this deliberately does NOT do:
--
--   * It never fires for the server. `auth.uid()` is null when the secret key
--     writes, and stock is decremented by the server on every order — a
--     restaurant that downgrades with stock still set must not find that its
--     orders stop going through.
--   * It only refuses a write that SETS or CHANGES the gated value. Clearing
--     it is always allowed, and so is renaming a dish that happens to carry a
--     stock count from a tier the restaurant used to be on. Otherwise a
--     downgrade would freeze every row it touched.
create or replace function public.enforce_plan_feature()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_column  text := tg_argv[0];
  v_allows  text := tg_argv[1];
  v_allowed boolean;
  v_before  text;
  v_after   text;
begin
  -- The server is not a customer. Only a browser session is held to the tier.
  if auth.uid() is null then return new; end if;

  if v_column = 'stock' then
    v_before := (case when tg_op = 'UPDATE' then old.stock::text end);
    v_after  := new.stock::text;
  else
    v_before := (case when tg_op = 'UPDATE' then old.schedule::text end);
    v_after  := new.schedule::text;
  end if;

  -- Unchanged, or being cleared: nothing is being taken that was not paid for.
  if v_after is null or v_after is not distinct from v_before then return new; end if;

  execute format('select l.%I from restaurants r join plan_limits l on l.plan = public.effective_restaurant_plan(r.id) where r.id = $1', v_allows)
    into v_allowed using new.restaurant_id;

  if v_allowed is distinct from true then
    raise exception 'tt_plan_feature %', v_allows using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function public.enforce_plan_feature() from public, anon, authenticated;
grant execute on function public.enforce_plan_feature() to service_role;

drop trigger if exists items_plan_feature_stock on menu_items;
create trigger items_plan_feature_stock before insert or update on menu_items
  for each row execute function public.enforce_plan_feature('stock', 'allows_inventory');

drop trigger if exists menus_plan_feature_schedule on menus;
create trigger menus_plan_feature_schedule before insert or update on menus
  for each row execute function public.enforce_plan_feature('schedule', 'allows_menu_schedules');

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
-- Carta is capped at one Servicio subscription, and that number is the whole
-- argument. Uncapped at MX$3 a pedido the free tier was the most expensive
-- plan we sold: 1,000 orders billed MX$3,000 — more than Casa, more than
-- Servicio's ceiling, and the restaurant paying it had thirty dishes and no
-- tables. A free tier that punishes the restaurants doing well on it does not
-- convert them, it loses them. Past MX$699 they are paying Servicio money, so
-- the honest thing is to stop charging and let the ladder make the argument.
update plan_limits set
  list_price = 0,    fee_cap = 699                    where plan = 'carta';
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
-- Named, not derived from `rank`: a tier added between two others would
-- inherit it by position (Caja arrived at rank 1).
update plan_limits set allows_menu_schedules = (plan in ('casa', 'grupo'));

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
update plan_limits set allows_deferred_payment = (plan in ('servicio', 'casa', 'grupo'));

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

-- Who opened this sitting: a member of staff, by email, or nobody.
--
-- A waiter who seats a party and takes their order owns the bill. The diners
-- can scan the table, see what has been ordered and add to it, but the money
-- is settled with the person standing in front of them — so the bill screen
-- offers to call them rather than a card field, and the routes that charge a
-- card refuse. Two people collecting the same bill through different doors is
-- how a table pays twice.
alter table table_sessions add column if not exists opened_by text;
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
  using (has_role(restaurant_id, array['manager', 'waiter', 'cashier']));
-- Only the floor reads sitting ids: /api/session uses them to reveal balances.
-- Customers never read this table; the server answers for them through
-- /api/session, which tells a phone only about its own sitting.
revoke all on table_sessions from anon;

alter table orders add column if not exists session_id uuid
  references table_sessions(id) on delete set null;
create index if not exists orders_session_idx on orders(session_id);

-- Which phone placed this order.
--
-- The throwaway token a diner's device gives itself for the evening — the same
-- one that holds a seat in a divided bill. It says which device, and nothing
-- else: no name, no account, nothing that outlives the meal, and useless at any
-- other table.
--
-- It is here so a table can be divided between the people who are actually
-- eating. One diner alone was offered a split between 2 and 20, proposed twelve
-- ways, and then could not pay at all until the proposal was called off:
-- eleven of those shares belonged to nobody, and a share nobody claims freezes
-- the bill for everybody. Counting the devices that have ordered on the sitting
-- is what makes the offer honest.
--
-- Null for an order a waiter typed in, and for a phone with storage switched
-- off. Those still ate: see `diningOn` in src/lib/table-party.ts.
alter table orders add column if not exists diner text;


-- Opens the table's sitting, or joins the one already open.
--
-- Security definer for the same reason redeem_coupon is: the customer's key
-- cannot touch this table, and the decision has to be atomic. The unique index
-- above is what makes the race safe — the loser of an insert re-reads the
-- winner's row instead of failing.
-- The three-argument version, replaced by the one below. Named exactly, so
-- re-running this file drops nothing that is still wanted.
drop function if exists public.open_table_session(uuid, uuid, int);

create or replace function public.open_table_session(
  p_restaurant uuid,
  p_table uuid,
  p_max_hours int,
  -- Set only when this call CREATES the sitting. A waiter adding a round to a
  -- table the diners opened themselves has not taken their bill off them.
  p_opened_by text default null
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
    insert into table_sessions (restaurant_id, table_id, opened_by)
    values (p_restaurant, p_table, p_opened_by)
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
revoke all on function public.open_table_session(uuid, uuid, int, text)
  from public, anon, authenticated;
grant execute on function public.open_table_session(uuid, uuid, int, text) to service_role;

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
     and account_id is null
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
  on write_off_requests for select
  using (has_role(restaurant_id, array['owner', 'manager', 'waiter', 'cashier']));
-- Never a customer's business: it names staff and what a table did not pay.
revoke all on write_off_requests from anon;
-- Only guarded routes may set the target, shown amount or decision.
revoke insert, update, delete on write_off_requests from authenticated;
grant select on write_off_requests to authenticated;

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

-- ── The counter till ────────────────────────────────────────────────────────
-- A cashier rings a sale, takes cash or a card on their own terminal, and the
-- order goes to the pass already paid for. No Stripe is involved at any point.
--
-- `pos_ref` is the cart the cashier was ringing, generated on their screen. It
-- makes the sale idempotent: a request that times out and is sent again lands
-- on this unique index instead of charging the same customer twice and putting
-- two tickets on the pass. Null for every order that did not come from a till,
-- so the index has to ignore those.
alter table orders add column if not exists pos_ref uuid;
create unique index if not exists orders_restaurant_pos_ref_once
  on orders (restaurant_id, pos_ref) where pos_ref is not null;
drop index if exists orders_pos_ref_once;

-- When a card checkout for this order last went to Stripe. A table's bill is
-- priced from its orders' totals when the diner opens Stripe, and the webhook
-- records those same orders' totals when the money lands — so switching the
-- service charge off must not lower a total while its checkout is open, or the
-- ledger records less than Stripe took. Set before the session is created;
-- sessions expire after 30 minutes, and repricing leaves these alone for 35.
alter table orders add column if not exists card_checkout_at timestamptz;

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
  -- A trusted stock movement: it keeps the dish's count generation.
  perform set_config('tabletap.stock_movement', 'on', true);
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
  -- A trusted stock movement: it keeps the dish's count generation.
  perform set_config('tabletap.stock_movement', 'on', true);
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

-- How much of this payment was a gratuity.
--
-- Attribution is unchanged: the tip lands on the order, accumulating, exactly
-- as settling a whole table already does, and the balance a waiter collects
-- against is simply what the orders come to less what has been paid — a tip is
-- on both sides of that and never moves it.
--
-- This is for the takings. A cashier counting a drawer and an owner reading
-- the day want the gratuities separated from the food, and `amount` alone
-- cannot say which part of MX$115 was which.
alter table payments add column if not exists tip numeric not null default 0
  check (tip >= 0);

-- One Stripe payment settles one order, once.
--
-- Stripe delivers a webhook again whenever it is not certain the first one
-- landed, and for a while two of the three settle paths took that second
-- delivery as a second payment: the row was marked paid, then read back and
-- recorded again, so the ledger, the corte and the day's takings all counted
-- money that arrived once as though it had arrived twice.
--
-- The paths are guarded now. This is the guard under the guard — the next
-- settle path somebody writes cannot get it wrong, because the database will
-- not hold the duplicate. Partial, because the two legitimate nulls must stay
-- allowed: cash carries no payment intent, and a share of a divided bill
-- belongs to the sitting rather than to any single order.
create unique index if not exists payments_one_per_intent
  on payments (order_id, stripe_payment_intent)
  where order_id is not null and stripe_payment_intent is not null;

-- One tap on a waiter's phone collects one payment, once.
--
-- The other half of the same problem, for money nobody's card is involved in.
-- A waiter settling a bill in parts is standing on a restaurant floor with a
-- phone: the button is tapped twice because the first tap seemed to do
-- nothing, or the request is retried when the signal comes back. Either way a
-- second MX$100 lands in the ledger, the bill reads as covered, and the table
-- walks out owing money nobody can see any more.
--
-- The client stamps each collection with a reference of its own and reuses it
-- for every retry of that one collection, so the database refuses the copy.
-- Partial, because every payment the app has recorded until now has no
-- reference at all and they must all stay allowed.
alter table payments add column if not exists client_ref text;
create unique index if not exists payments_one_per_ref
  on payments (restaurant_id, client_ref)
  where client_ref is not null;

alter table payments enable row level security;

-- The whole team reads them: a cashier's own takings and the day's count are
-- both built from this. Nobody writes from a browser — money is recorded by
-- the routes that took it, with the secret key.
drop policy if exists "team reads payments" on payments;
-- Everyone who settles a bill, which is everyone except the kitchen.
--
-- It said `works_at` — the whole team, the pass included. That was invisible
-- while every payment was anonymous and the corte could not be computed from
-- them; once the ledger carried real amounts and the name of whoever took the
-- cash, it meant a kitchen hand could read the restaurant's entire takings and
-- see what each person on the floor had collected. The kitchen cooks; it does
-- not count the drawer.
--
-- `SETTLES` in the app is `role !== 'kitchen'`, and this is that rule written
-- where it is actually enforced.
-- Both names dropped: this file re-runs on every deploy, and dropping only the
-- name being replaced leaves the new one to collide with itself the second
-- time through.
drop policy if exists "team reads payments" on payments;
drop policy if exists "the floor reads payments" on payments;
create policy "the floor reads payments"
  on payments for select
  using (has_role(restaurant_id, array['manager', 'waiter', 'cashier']));

revoke all on payments from anon;
grant select on payments to authenticated;

-- Historical receipt initialization retired; allocation backfills never create payments.
-- The retired receipt initializer could manufacture duplicate receipts for pooled/account settlements.

-- ── Dividing a bill ─────────────────────────────────────────────────────────
-- A table agreeing to pay the same amount each.
--
-- It only works if everybody agrees, so a split is a proposal until every
-- person has joined it. The moment the last one does, the amount FREEZES: the
-- table divides what it owed at that instant, and anything ordered afterwards
-- belongs to whoever ordered it. That is the rule a table actually follows —
-- they agreed to divide the meal they had eaten, not to buy each other another
-- round — and freezing is also what lets someone keep ordering while the others
-- are paying, which is money we would otherwise be turning away.
--
-- No browser policy: a diner has no login, so every read and write goes through
-- the routes with the secret key, addressed by a sitting id nobody can guess.
create table if not exists bill_splits (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  session_id    uuid not null references table_sessions(id) on delete cascade,
  shares        int not null check (shares between 2 and 20),
  -- What the table owed when everyone agreed. Zero until it locks.
  amount        numeric not null default 0 check (amount >= 0),
  status        text not null default 'proposed'
                check (status in ('proposed', 'locked', 'cancelled', 'done')),
  -- The device that asked, which is also the one that carries the odd cent.
  proposed_by   text not null,
  created_at    timestamptz not null default now(),
  locked_at     timestamptz,
  -- A proposal nobody finishes must not trap the table forever: one person in
  -- the bathroom would otherwise leave the rest unable to pay at all.
  expires_at    timestamptz not null default now() + interval '30 minutes'
);

-- One live proposal per sitting. Two people asking at once would otherwise
-- divide the same bill twice and each collect a different amount.
create unique index if not exists bill_splits_one_live
  on bill_splits(session_id) where status in ('proposed', 'locked');
create index if not exists bill_splits_session_idx on bill_splits(session_id);

-- Who has agreed, and what each of them owes once it froze.
create table if not exists bill_split_claims (
  split_id   uuid not null references bill_splits(id) on delete cascade,
  share_no   int not null,
  -- The diner's own device, the only identity anybody has here.
  diner      text not null,
  amount     numeric not null default 0 check (amount >= 0),
  payment_id uuid references payments(id) on delete set null,
  claimed_at timestamptz not null default now(),
  paid_at    timestamptz,
  primary key (split_id, share_no)
);
-- One share each: a device that joined cannot quietly take a second.
create unique index if not exists bill_split_claims_one_each
  on bill_split_claims(split_id, diner);

alter table bill_splits add column if not exists order_ids uuid[] not null default '{}';
alter table bill_splits enable row level security;
alter table bill_split_claims enable row level security;

-- The floor can look at what a table is doing, so a waiter can see why the
-- screen says a bill is being divided and can call it off.
drop policy if exists "team reads splits" on bill_splits;
create policy "team reads splits"
  on bill_splits for select using (has_role(restaurant_id, array['manager', 'waiter', 'cashier']));

drop policy if exists "team reads split claims" on bill_split_claims;
create policy "team reads split claims"
  on bill_split_claims for select using (
    exists (select 1 from bill_splits s
             where s.id = split_id and has_role(s.restaurant_id, array['manager', 'waiter', 'cashier']))
  );

revoke all on bill_splits from anon;
revoke all on bill_split_claims from anon;
grant select on bill_splits to authenticated;
grant select on bill_split_claims to authenticated;

-- Taking a share, atomically.
--
-- Two phones tapping "join" at the same instant must not take the same seat,
-- and the last one in is what freezes the amount — so the whole thing is one
-- statement holding the row, the way a coupon is claimed.
drop function if exists public.join_bill_split(uuid, text, numeric);
create or replace function public.join_bill_split(
  p_split uuid, p_diner text, p_restaurant uuid, p_table uuid, p_session uuid
) returns int language plpgsql security definer set search_path = public as $$
declare
  v_split bill_splits%rowtype;
  v_sitting table_sessions%rowtype;
  v_taken int;
  v_next int;
  v_amount numeric;
  v_freeze timestamptz;
begin
  perform public.lock_restaurant_money(p_restaurant);
  select * into v_split from bill_splits where id = p_split;
  if not found then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_split.session_id::text, 0));
  select * into v_split from bill_splits where id = p_split for update;
  select * into v_sitting from table_sessions where id = v_split.session_id for update;
  -- A split id cannot borrow a cheaper table's sitting or restaurant.
  if v_split.session_id is distinct from p_session
     or v_split.restaurant_id is distinct from p_restaurant
     or v_sitting.restaurant_id is distinct from v_split.restaurant_id
     or v_sitting.table_id is distinct from p_table
     or v_split.status <> 'proposed' or v_split.expires_at <= now() then return null; end if;

  select share_no into v_next from bill_split_claims
   where split_id = p_split and diner = p_diner;
  if v_next is not null then return v_next; end if;
  select count(*) into v_taken from bill_split_claims where split_id = p_split;
  if v_taken >= v_split.shares then return null; end if;

  perform 1 from orders where session_id = v_split.session_id
    and restaurant_id = v_split.restaurant_id and table_id = v_sitting.table_id
    order by id for update;
  v_freeze := clock_timestamp();
  select coalesce(sum(total), 0) into v_amount from orders
   where session_id = v_split.session_id and restaurant_id = v_split.restaurant_id
     and table_id = v_sitting.table_id and paid = false and written_off = false
     and account_id is null and status not in ('cancelled', 'pending_payment')
     and created_at < v_freeze;
  if v_amount <= 0 then return null; end if;

  v_next := v_taken;
  insert into bill_split_claims (split_id, share_no, diner) values (p_split, v_next, p_diner);
  if v_taken + 1 = v_split.shares then
    update bill_splits set status = 'locked', locked_at = v_freeze, amount = round(v_amount, 2)
     where id = p_split;
    -- Shares are ready before the lock becomes visible to a paying phone.
    update bill_split_claims
       set amount = (floor(round(v_amount * 100) / v_split.shares)
         + case when share_no = 0 then mod(round(v_amount * 100), v_split.shares) else 0 end) / 100
     where split_id = p_split;
  end if;
  return v_next;
end; $$;
revoke all on function public.join_bill_split(uuid, text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.join_bill_split(uuid, text, uuid, uuid, uuid) to service_role;

-- All seats paid is only a count. The sitting's ledger must cover its food too.
create or replace function public.close_divided_bill(p_split uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_split bill_splits%rowtype;
  v_count int;
  v_shares numeric;
  v_owed numeric;
  v_collected numeric;
  v_spent numeric;
begin
  perform public.lock_restaurant_money((select restaurant_id from bill_splits where id = p_split));
  select * into v_split from bill_splits where id = p_split;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_split.session_id::text, 0));
  select * into v_split from bill_splits where id = p_split for update;
  if v_split.status = 'done' then return true; end if;
  if v_split.status <> 'locked' then return false; end if;
  perform 1 from bill_split_claims where split_id = p_split order by share_no for update;
  select count(*), coalesce(sum(amount), 0) into v_count, v_shares
    from bill_split_claims where split_id = p_split and paid_at is not null;
  if v_count <> v_split.shares or v_shares < v_split.amount then return false; end if;

  perform 1 from orders where session_id = v_split.session_id
    and restaurant_id = v_split.restaurant_id order by id for update;
  select coalesce(sum(total), 0) into v_owed from orders
   where session_id = v_split.session_id and restaurant_id = v_split.restaurant_id
     and created_at < v_split.locked_at and paid = false and written_off = false
     and account_id is null and status not in ('cancelled', 'pending_payment');
  select coalesce(sum(amount), 0) into v_collected from payments
   where session_id = v_split.session_id and restaurant_id = v_split.restaurant_id and order_id is null;
  -- Sitting payments already spent on paid orders cannot cover this pot again.
  select coalesce(sum(greatest(o.total - coalesce(p.amount, 0), 0)), 0) into v_spent
    from orders o left join (
      select order_id, sum(amount) amount from payments
       where restaurant_id = v_split.restaurant_id and order_id is not null group by order_id
    ) p on p.order_id = o.id
   where o.session_id = v_split.session_id and o.restaurant_id = v_split.restaurant_id
     and o.paid = true and o.written_off = false and o.status not in ('cancelled', 'pending_payment');
  if v_collected - v_spent < v_owed then return false; end if;
  update orders set paid = true, pay_method = 'card'
   where session_id = v_split.session_id and restaurant_id = v_split.restaurant_id
     and created_at < v_split.locked_at and paid = false and written_off = false
     and account_id is null and status not in ('cancelled', 'pending_payment');
  update bill_splits set status = 'done' where id = p_split;
  return true;
end; $$;
revoke all on function public.close_divided_bill(uuid) from public, anon, authenticated;
grant execute on function public.close_divided_bill(uuid) to service_role;


-- ── Collecting part of a bill, atomically ───────────────────────────────────
--
-- Two waiters collecting the same table at the same second took MX$400 for a
-- MX$200 dinner. The route read what was owed, capped the amount against it,
-- and inserted — three steps with nothing holding the table still between the
-- first and the last, so both requests read MX$200 owing and both recorded it.
-- Five at once took MX$800. `client_ref` never caught it: that guards one
-- collection retried, and this is two collections that genuinely differ.
--
-- So the read, the cap and the insert happen here, under a lock on the sitting.
-- The lock is transaction-scoped and a function call is its own transaction, so
-- it is held exactly as long as the decision takes.
--
-- The cap is not an error. A waiter who types MX$200 while a colleague is
-- taking MX$150 of it should record the MX$50 that is genuinely left, and the
-- caller is told what actually landed so the receipt, the tip and the log line
-- all describe the same money.
create or replace function public.collect_on_sitting(
  p_restaurant uuid,
  p_session    uuid,
  p_amount     numeric,
  p_tip        numeric,
  p_method     text,
  p_actor      text,
  p_ref        text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owed  numeric;
  v_paid  numeric;
  v_spent numeric;
  v_room  numeric;
  v_take  numeric;
begin
  perform public.lock_restaurant_money(p_restaurant);
  -- One collection at a time per sitting. Everything below reads live.
  perform pg_advisory_xact_lock(hashtextextended(p_session::text, 0));

  select coalesce(sum(total), 0) into v_owed
    from orders
   where session_id = p_session
     and paid = false
     and written_off = false
     and account_id is null
     and status <> 'cancelled'
     and status <> 'pending_payment';

  -- Money already against this sitting that belongs to no single order, which
  -- is what a collection in parts and a divided bill both write.
  select coalesce(sum(amount), 0) into v_paid
    from payments
   where session_id = p_session
     and order_id is null;

  -- What that money has already been spent on. A collection settles the orders
  -- it covers and those orders STAY on the sitting, so counting the sitting's
  -- whole history of payments against whatever is unpaid now spends the same
  -- pesos twice — a table that paid MX$200 and then ordered MX$60 more read as
  -- owing nothing. Mirrors `creditFor` in table-outstanding.ts, which is the
  -- one place this rule is supposed to live; the two must agree.
  select coalesce(sum(greatest(o.total - coalesce(own.paid, 0), 0)), 0) into v_spent
    from orders o
    left join (
      select order_id, sum(amount) as paid
        from payments
       where order_id is not null
       group by order_id
    ) own on own.order_id = o.id
   where o.session_id = p_session
     and o.paid = true
     and o.written_off = false
     and o.status <> 'cancelled'
     and o.status <> 'pending_payment';

  v_room := round(v_owed - greatest(v_paid - v_spent, 0), 2);
  if v_room <= 0 then
    return jsonb_build_object('taken', 0, 'tip', 0, 'outcome', 'covered');
  end if;

  -- The ceiling is what is owed PLUS the gratuity this payment carries.
  --
  -- `payments.amount` is inclusive of its tip, and the order does not carry
  -- that tip yet — `addTip` puts it on the oldest order a moment after this
  -- returns. Capping against the food alone therefore truncates the tip off
  -- the share that carries it, which is the same food-versus-total confusion
  -- that once read a table owing MX$94.07 as MX$93.17. The caller pads the
  -- first sitting by the same amount before sharing out, for the same reason.
  v_take := least(round(p_amount, 2), round(v_room + coalesce(p_tip, 0), 2));
  if v_take <= 0 then
    return jsonb_build_object('taken', 0, 'tip', 0, 'outcome', 'covered');
  end if;

  begin
    insert into payments (restaurant_id, session_id, amount, tip, method, actor_email, client_ref)
    values (p_restaurant, p_session, v_take, coalesce(p_tip, 0), p_method, p_actor, p_ref);
  exception when unique_violation then
    -- The same collection arriving twice. The money is already in, once.
    return jsonb_build_object('taken', 0, 'tip', 0, 'outcome', 'duplicate');
  end;

  return jsonb_build_object('taken', v_take, 'tip', coalesce(p_tip, 0), 'outcome', 'written');
end;
$$;
revoke all on function public.collect_on_sitting(uuid, uuid, numeric, numeric, text, text, text)
  from public, anon, authenticated;
grant execute on function public.collect_on_sitting(uuid, uuid, numeric, numeric, text, text, text)
  to service_role;

-- Settling orders and recording the money they brought, as one write.
--
-- Settling a table in person was two: the orders marked paid, then a payment
-- written to the ledger. When the second failed the orders read as paid with
-- nothing behind them — the corte short by exactly that bill — and nothing
-- could repair it, because every path guards on `paid = false` and the orders
-- no longer were. Here both happen, or neither does.
--
-- The caller reads what is owed and names exactly the orders it is settling.
-- If any of them is no longer owed by the time its row is locked — another
-- waiter got there first, a card payment landed, a manager wrote it off —
-- nothing is written and the call fails with `not_owed`, so the waiter looks
-- again instead of recording money against a bill that changed under them.
--
-- `p_sittings` null: each order is recorded for its own total. Otherwise the
-- table had already handed over part of its bill, and only the remainder is
-- recorded, against each sitting it pays for ([{session_id, amount}]) — every
-- centavo before it is in the ledger under its own collection.
create or replace function public.settle_orders(
  p_restaurant uuid,
  p_orders     uuid[],
  p_method     text,
  p_actor      text,
  p_sittings   jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  perform public.lock_restaurant_money(p_restaurant);
  if p_method not in ('cash', 'card') then
    raise exception 'settle_orders: unknown method %', p_method;
  end if;
  if coalesce(cardinality(p_orders), 0) = 0 then
    raise exception 'not_owed';
  end if;
  -- A sitting is only ever this restaurant's own.
  if p_sittings is not null and exists (
    select 1 from jsonb_array_elements(p_sittings) p
     where not exists (
       select 1 from table_sessions s
        where s.id = (p->>'session_id')::uuid and s.restaurant_id = p_restaurant)
  ) then
    raise exception 'settle_orders: a sitting that is not this restaurant''s';
  end if;

  with settled as (
    update orders
       set paid = true, pay_method = p_method
     where restaurant_id = p_restaurant
       and id = any(p_orders)
       and paid = false
       and account_id is null
       and written_off = false
       and status <> 'pending_payment'
       and status <> 'cancelled'
    returning id, session_id, total
  ), written as (
    insert into payments (restaurant_id, order_id, session_id, amount, method, actor_email)
    select p_restaurant, s.id, s.session_id, round(s.total, 2), p_method, p_actor
      from settled s
     where p_sittings is null and s.total > 0
    returning 1
  )
  select count(*) into v_count from settled;

  -- All of them, or none: a bill that changed is looked at again.
  if v_count <> cardinality(p_orders) then
    raise exception 'not_owed';
  end if;

  if p_sittings is not null then
    insert into payments (restaurant_id, session_id, amount, method, actor_email)
    select p_restaurant, (p->>'session_id')::uuid, round((p->>'amount')::numeric, 2), p_method, p_actor
      from jsonb_array_elements(p_sittings) p
     where (p->>'amount')::numeric > 0;
  end if;

  return v_count;
end;
$$;
revoke all on function public.settle_orders(uuid, uuid[], text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.settle_orders(uuid, uuid[], text, text, jsonb)
  to service_role;

-- Money taken twice: a card payment that arrived for orders somebody had
-- already settled — a waiter took cash for the table while a diner was on
-- Stripe's page. The card money is real and is not the restaurant's to keep,
-- so it is not put in the ledger (every reader of `payments` would count it as
-- the table's money) and it is not dropped either, which is what happened: it
-- is kept here, the owner and managers are told, and `pnpm money` lists it
-- until somebody refunds it from Cuentas, which returns our fee with it.
create table if not exists refunds_due (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  stripe_payment_intent text not null,
  amount        numeric not null check (amount > 0),
  order_ids     uuid[] not null default '{}',
  table_label   text,
  created_at    timestamptz not null default now(),
  refunded_at   timestamptz
);
-- Whose money it is when it is not a table's: a customer account's name.
alter table refunds_due add column if not exists account_name text;
-- Who gave it back, and the refund Stripe made. Written only after Stripe has
-- made it: a row marked refunded first would be a diner who never was.
alter table refunds_due add column if not exists stripe_refund_id text;
alter table refunds_due add column if not exists refunded_by text;
-- One per payment: Stripe repeats a webhook, and a repeat is not a second refund.
create unique index if not exists refunds_due_one_per_intent on refunds_due(stripe_payment_intent);
create index if not exists refunds_due_restaurant_idx on refunds_due(restaurant_id, created_at desc);
alter table refunds_due enable row level security;
revoke all on refunds_due from anon;
drop policy if exists "managers read refunds due" on refunds_due;
create policy "managers read refunds due"
  on refunds_due for select
  using (has_role(restaurant_id, array['manager']));

-- The bell says so: money a diner must be given back is the owner's to act on.
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('low_stock', 'out_of_stock', 'refund_due'));

-- A card payment Stripe confirmed, written with the orders it paid for.
--
-- The webhook marked the orders paid and then wrote the ledger, two writes; a
-- failed second one left orders paid with the diner's money recorded nowhere.
-- Here the orders still owed are marked paid and each is recorded for its
-- total in one transaction, the gratuity riding on one order — added to its
-- tip and its total, and to the payment that carries it, so the order and the
-- ledger stay one number.
--
-- Stripe repeats a webhook it is not sure landed, so this is safe to run
-- twice: only orders still unpaid are touched, and a repeat touches none.
-- It answers which orders it settled and which it did not, because an order
-- somebody else settled while the diner was on Stripe's page is money taken
-- twice, and the caller must not let that pass in silence.
-- What Stripe charged for these orders (`p_charged`) is how a payment that
-- landed on orders already settled is found: less was recorded under it than
-- was taken, and the difference is a refund the restaurant owes the diner.
drop function if exists public.settle_card_orders(uuid[], text, numeric, uuid, text);
create or replace function public.settle_card_orders(
  p_orders    uuid[],
  p_intent    text,
  p_tip       numeric,
  p_tip_order uuid,
  p_status    text,
  -- Defaulted, so the call written before it existed still finds this function.
  p_charged   numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settled  uuid[];
  v_tip_on   uuid;
  v_missed   uuid[];
  v_recorded numeric;
  v_owed     numeric;
  v_rest     uuid;
  v_label    text;
  v_currency text;
begin
  perform public.lock_restaurant_money((select restaurant_id from orders where id = any(p_orders) limit 1));
  -- Held for the rest of the call, so the choice below and the update after it
  -- see the same orders: a waiter settling one in between waits for this.
  perform 1 from orders where id = any(p_orders) order by id for update;

  -- Which order carries the gratuity: the one asked for if this call settles
  -- it, otherwise the first that it does settle.
  select coalesce(
           (select o.id from orders o where o.id = p_tip_order and o.id = any(p_orders) and o.paid = false),
           (select o.id from orders o where o.id = any(p_orders) and o.paid = false order by o.created_at, o.id limit 1))
    into v_tip_on;

  with settled as (
    update orders
       set paid = true,
           pay_method = 'card',
           status = coalesce(p_status, status),
           stripe_payment_intent = case when p_status is null then stripe_payment_intent else p_intent end
     where id = any(p_orders)
       and paid = false
    returning id, session_id, total, restaurant_id
  ), written as (
    insert into payments (restaurant_id, order_id, session_id, amount, tip, method, stripe_payment_intent)
    select s.restaurant_id, s.id, s.session_id,
           round(s.total + case when s.id = v_tip_on then coalesce(p_tip, 0) else 0 end, 2),
           case when s.id = v_tip_on then round(coalesce(p_tip, 0), 2) else 0 end,
           'card', p_intent
      from settled s
     where s.total + case when s.id = v_tip_on then coalesce(p_tip, 0) else 0 end > 0
    on conflict do nothing
    returning 1
  )
  select coalesce(array_agg(id), '{}') into v_settled from settled;

  if coalesce(p_tip, 0) > 0 and v_tip_on = any(v_settled) then
    update orders
       set tip = round(coalesce(tip, 0) + p_tip, 2), total = round(total + p_tip, 2)
     where id = v_tip_on;
  end if;

  v_missed := coalesce((select array_agg(o) from unnest(p_orders) o where not (o = any(v_settled))), '{}');

  -- Orders this payment was for that somebody else had settled. Whatever was
  -- charged and is not in the ledger under this payment — a repeat of the
  -- event finds it all there — is money taken twice.
  if cardinality(v_missed) > 0 and coalesce(p_charged, 0) > 0 and p_intent is not null then
    select coalesce(sum(amount), 0) into v_recorded
      from payments where stripe_payment_intent = p_intent and order_id = any(p_orders);
    v_owed := round(p_charged - v_recorded, 2);
    if v_owed > 0 then
      select o.restaurant_id, o.table_label, o.currency into v_rest, v_label, v_currency
        from orders o where o.id = v_missed[1];
      if v_rest is not null then
        insert into refunds_due (restaurant_id, stripe_payment_intent, amount, order_ids, table_label)
        values (v_rest, p_intent, v_owed, v_missed, v_label)
        on conflict (stripe_payment_intent) do nothing;
        if found then
          insert into notifications (restaurant_id, kind, data)
          values (v_rest, 'refund_due',
                  jsonb_build_object('amount', v_owed, 'currency', v_currency, 'table', v_label));
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'settled', to_jsonb(v_settled),
    'tip_on', v_tip_on,
    'not_settled', to_jsonb(v_missed));
end;
$$;
revoke all on function public.settle_card_orders(uuid[], text, numeric, uuid, text, numeric)
  from public, anon, authenticated;
grant execute on function public.settle_card_orders(uuid[], text, numeric, uuid, text, numeric)
  to service_role;

-- One diner's share of a divided bill, paid by card: the seat claimed, the
-- money recorded against the sitting, and the gratuity put on the sitting's
-- oldest order — together. The claim was one write and the payment another,
-- and when the second failed the share read as paid with the diner's money
-- recorded nowhere; a repeat of the event found the seat already claimed and
-- did nothing. Answers whether this call claimed it, so a repeat records
-- nothing twice.
create or replace function public.settle_split_share(
  p_split  uuid,
  p_share  int,
  p_amount numeric,
  p_tip    numeric,
  p_intent text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant uuid;
  v_session    uuid;
  v_claimed    int;
begin
  perform public.lock_restaurant_money((select restaurant_id from bill_splits where id = p_split));
  select restaurant_id, session_id into v_restaurant, v_session from bill_splits where id = p_split;
  if not found then return false; end if;

  update bill_split_claims set paid_at = now()
   where split_id = p_split and share_no = p_share and paid_at is null;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then return false; end if;

  insert into payments (restaurant_id, session_id, amount, tip, method, stripe_payment_intent)
  values (v_restaurant, v_session, round(p_amount + coalesce(p_tip, 0), 2),
          round(coalesce(p_tip, 0), 2), 'card', p_intent);

  -- `total` and `tip` rise together, so a running balance still reads the
  -- same food as owed — the way settling a whole table and collecting in
  -- parts both attribute a gratuity.
  if coalesce(p_tip, 0) > 0 then
    update orders
       set tip = round(coalesce(tip, 0) + p_tip, 2), total = round(total + p_tip, 2)
     where id = (
       select id from orders
        where session_id = v_session
          and status <> 'cancelled' and status <> 'pending_payment' and written_off = false
        order by created_at asc limit 1);
  end if;
  return true;
end;
$$;
revoke all on function public.settle_split_share(uuid, int, numeric, numeric, text)
  from public, anon, authenticated;
grant execute on function public.settle_split_share(uuid, int, numeric, numeric, text)
  to service_role;

-- A share already paid, charged again by a different payment: two checkouts
-- for one share, both paid. `settle_split_share` claimed nothing the second
-- time and the money was recorded nowhere — the diner paid twice and nobody
-- was told. The second charge is a refund due, like a table paid twice.
-- 'repeat' when this very charge is already in the ledger (Stripe sending it
-- again); 'duplicate' once the refund due is written; 'none' otherwise.
create or replace function public.record_duplicate_share(p_split uuid, p_intent text, p_amount numeric)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_rest uuid;
  v_label text;
  v_currency text;
begin
  if p_intent is null then return 'none'; end if;
  if exists (select 1 from payments where stripe_payment_intent = p_intent) then return 'repeat'; end if;
  if exists (select 1 from refunds_due where stripe_payment_intent = p_intent) then return 'duplicate'; end if;
  if coalesce(p_amount, 0) <= 0 then return 'none'; end if;
  select s.restaurant_id, t.label, r.currency into v_rest, v_label, v_currency
    from bill_splits s
    join restaurants r on r.id = s.restaurant_id
    left join table_sessions ts on ts.id = s.session_id
    left join restaurant_tables t on t.id = ts.table_id
   where s.id = p_split;
  if v_rest is null then return 'none'; end if;
  insert into refunds_due (restaurant_id, stripe_payment_intent, amount, order_ids, table_label)
  values (v_rest, p_intent, round(p_amount, 2), '{}', v_label)
  on conflict (stripe_payment_intent) do nothing;
  if found then
    insert into notifications (restaurant_id, kind, data)
    values (v_rest, 'refund_due', jsonb_build_object('amount', round(p_amount, 2), 'currency', v_currency, 'table', v_label));
  end if;
  return 'duplicate';
end;
$$;
revoke all on function public.record_duplicate_share(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.record_duplicate_share(uuid, text, numeric) to service_role;

-- A sale rung at the till, settled with the money it took.
--
-- The till inserted the order already paid and then wrote the ledger; a failed
-- second write was a sale in the day's orders with no money in the corte. Now
-- the order goes in as `pending_payment` — which no board, bill or corte
-- counts, exactly like a card order waiting on Stripe — and this marks it paid,
-- gives it its real status (which is what prints the kitchen ticket) and
-- records the money in one transaction. If this fails the route deletes the
-- order and puts its stock back: the sale did not happen.
create or replace function public.settle_sale(
  p_restaurant uuid,
  p_order      uuid,
  p_method     text,
  p_actor      text,
  p_status     text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
begin
  perform public.lock_restaurant_money(p_restaurant);
  if p_method not in ('cash', 'card') then
    raise exception 'settle_sale: unknown method %', p_method;
  end if;
  if p_status not in ('received', 'completed') then
    raise exception 'settle_sale: a sale cannot be %', p_status;
  end if;

  update orders
     set paid = true, pay_method = p_method, status = p_status
   where id = p_order
     and restaurant_id = p_restaurant
     and paid = false
     and status = 'pending_payment'
  returning total into v_total;
  if not found then
    raise exception 'not_owed';
  end if;

  if v_total > 0 then
    insert into payments (restaurant_id, order_id, amount, method, actor_email)
    values (p_restaurant, p_order, round(v_total, 2), p_method, p_actor);
  end if;
  return true;
end;
$$;
revoke all on function public.settle_sale(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.settle_sale(uuid, uuid, text, text, text)
  to service_role;

-- ── Printing ────────────────────────────────────────────────────────────────
-- Tickets on paper: the receipt handed across the counter, and the order that
-- lands on the pass.
--
-- The counter receipt needs nothing here — it prints from the browser through
-- whatever printer the machine already has. The kitchen is the part that needs
-- the database, because nobody is standing at the kitchen printer to press
-- print. The printer asks us instead: a CloudPRNT printer polls a URL over
-- plain outbound HTTPS every few seconds, and we answer with whatever is
-- waiting. No inbound access to the restaurant's network, no software
-- installed on their machines, and no port forwarding — the shape that does
-- not require us to reach into somebody else's LAN.
alter table restaurants add column if not exists auto_print_kitchen boolean not null default false;

-- Products that need no preparation: a bottled drink, a bag of coffee, a
-- packaged snack. The cashier takes them off the shelf and puts them in the
-- customer's hand, so there is nothing for a cook to make and nothing to wait
-- for.
--
-- It means "needs no preparation", not "skip the order". A bottled water
-- ordered from table 6 still has to be carried to table 6, so a QR order goes
-- to the pass exactly as before whatever this says. The counter is the one
-- place where no preparation ALSO means already delivered, because the person
-- ringing it up is the person handing it over.
alter table menu_items add column if not exists skips_kitchen boolean not null default false;

-- The printer's only credential. It cannot log in, hold a session or send a
-- header we choose, so the URL it is configured with IS the secret — which is
-- why this column appears in NO grant list: neither `anon` nor `authenticated`
-- can read it, and the settings screen fetches it through the server. Null
-- until somebody turns printing on, and rotatable from the same screen, so a
-- token that ends up on a sticky note can be revoked without new hardware.
alter table restaurants add column if not exists print_token text;
create unique index if not exists restaurants_print_token_once
  on restaurants (print_token) where print_token is not null;

-- What is waiting to be printed. One row per ticket, not per attempt: a job is
-- claimed when the printer fetches it and closed when the printer confirms, so
-- a printer that dies mid-ticket leaves the row claimed and re-prints rather
-- than losing the order.
create table if not exists print_jobs (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  order_id      uuid not null references orders(id) on delete cascade,
  kind          text not null default 'kitchen',
  created_at    timestamptz not null default now(),
  claimed_at    timestamptz,
  printed_at    timestamptz
);
-- The row stays the same on a reprint, but each requested copy has its own
-- token. A late confirmation of the old paper must not close the new copy.
alter table print_jobs add column if not exists delivery_token uuid not null default gen_random_uuid();
create unique index if not exists print_jobs_delivery_token_once
  on print_jobs (delivery_token);

-- The queue is read as "the oldest thing this restaurant has not printed",
-- which is exactly this index.
create index if not exists print_jobs_pending_idx
  on print_jobs (restaurant_id, created_at) where printed_at is null;
-- An order is queued once. A retried write, or a status that flips back and
-- forth, must not put the same ticket on the paper twice.
create unique index if not exists print_jobs_once
  on print_jobs (order_id, kind);

-- Nobody but the server touches the queue: a diner has no business knowing
-- what the kitchen is printing, and staff read the board, not this table.
alter table print_jobs enable row level security;
revoke all on print_jobs from anon, authenticated;

-- An order reaches the pass from several directions — a diner paying online, a
-- table ordering to settle later, a cashier ringing a sale — and every one of
-- them has to queue a ticket. Rather than remembering that in each, the row
-- itself decides: the moment an order becomes `received`, it is queued, and
-- only if the restaurant asked for automatic printing. A path added later is
-- covered without anybody having to notice this exists.
create or replace function public.enqueue_kitchen_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'received'
     and (tg_op = 'INSERT' or old.status is distinct from 'received')
     and exists (
       select 1 from restaurants r
       where r.id = new.restaurant_id and r.auto_print_kitchen
     )
  then
    -- Swallowed on purpose, and this is the whole reason the block exists: an
    -- order is money, a print job is paper. If queuing the ticket ever fails —
    -- a constraint nobody predicted, a table mid-migration — the sale must
    -- still be recorded. A trigger that raises here would roll back the order
    -- that fired it, and a restaurant would lose a paid sale because a printer
    -- queue hiccuped. The kitchen board still shows the order; only the paper
    -- is missed.
    begin
      insert into print_jobs (restaurant_id, order_id, kind)
      values (new.restaurant_id, new.id, 'kitchen')
      on conflict (order_id, kind) do nothing;
    exception when others then
      null;
    end;
  end if;
  return new;
end; $$;

drop trigger if exists orders_enqueue_kitchen_ticket on orders;
create trigger orders_enqueue_kitchen_ticket
  after insert or update of status on orders
  for each row execute function public.enqueue_kitchen_ticket();

revoke all on function public.enqueue_kitchen_ticket() from public, anon, authenticated;

-- An order paid for while it waits in "Listos" is done: the restaurant asked
-- for it to leave the board by itself rather than wait for somebody to move
-- it. Ready and not yet paid, it stays — moved by hand, or completed here the
-- moment the last of its money lands. Done in the database because money
-- reaches an order by many roads (card webhook, cash at the table, the till,
-- a split's last share, a customer account), and every one of them sets
-- `paid`. An update that sets a status of its own is left to say what it means.
create or replace function public.complete_when_paid()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.paid and not old.paid and old.status = 'ready' and new.status = 'ready' then
    new.status := 'completed';
  end if;
  return new;
end; $$;
drop trigger if exists orders_complete_when_paid on orders;
create trigger orders_complete_when_paid
  before update of paid on orders
  for each row execute function public.complete_when_paid();
revoke all on function public.complete_when_paid() from public, anon, authenticated;

-- ============================================================================
-- Loyalty: a visit card the diner keeps on their phone.
--
-- Nothing here names a person. A card is a random code; a visit is a card, a
-- day and the member of staff who scanned it; a redemption is a card, the
-- visits it used and the reward as it read at the time. Today the card is an
-- image the diner saves. The same rows are what a Wallet pass would be built
-- from later: the card's id is its serial, its code is its barcode, and the
-- visits are its progress — so moving to Apple or Google Wallet adds a way of
-- showing a card, not a new kind of card.
--
-- Progress is never stored. It is the visits a card has minus the visits its
-- redemptions used, counted from the rows every time, because a counter kept
-- beside the rows is a second record of one fact.
-- ============================================================================
alter table plan_limits add column if not exists allows_loyalty boolean not null default false;
-- Every paid tier since Caja: the register-only plan includes it, so the tier
-- above it must too, or upgrading from Caja would take the visit card away.
update plan_limits set allows_loyalty = true where plan in ('caja', 'servicio', 'casa', 'grupo');

-- ── Caja: the register, on its own ──────────────────────────────────────────
-- A counter that takes the order face to face and the money at the till, and
-- nothing that goes through the diner's phone: no ordering from a QR, no tables,
-- no kitchen screen. What most small places already have is a register, and
-- this is what replaces it — cash, their own card terminal, tips, receipts —
-- with promotions priced for them, stock that takes a dish off when it runs
-- out, and the visit card stamped at the till. Diners can still scan the QR
-- and read the menu; they order at the register.
--
-- It earns no per-order fee: none of its money touches Stripe. The
-- subscription is what pays for it, which is why it is priced below Servicio
-- rather than at the free tier.
--
-- Two new permissions, true for every tier that already had the thing they
-- name, so nothing changes for them: ordering from the diner's phone, and the
-- kitchen board a sale goes to once it is paid.
alter table plan_limits drop constraint if exists plan_limits_plan_check;
alter table plan_limits add constraint plan_limits_plan_check
  check (plan in ('carta', 'caja', 'servicio', 'casa', 'grupo'));
alter table plan_limits add column if not exists allows_online_ordering boolean not null default true;
alter table plan_limits add column if not exists allows_kitchen_board boolean not null default true;

-- Every column named, and last in the file, so a fresh database gets the whole
-- row rather than whatever the updates above happened to reach.
insert into plan_limits (
  plan, rank, monthly_price, list_price, order_fee, fee_cap,
  max_tables, max_staff, max_menus, max_items,
  allows_dine_in, allows_waiter_service, allows_deferred_payment,
  allows_online_ordering, allows_kitchen_board, allows_pos,
  allows_promotions, allows_coupons, allows_staff_discounts,
  allows_menu_schedules, allows_inventory, allows_loyalty
) values (
  'caja', 1, 399, 399, 0, 0,
  0, 5, 3, null,
  false, false, false,
  false, false, true,
  true, false, false,
  false, true, true
)
on conflict (plan) do update set
  rank = excluded.rank, monthly_price = excluded.monthly_price,
  list_price = excluded.list_price, order_fee = excluded.order_fee,
  fee_cap = excluded.fee_cap, max_tables = excluded.max_tables,
  max_staff = excluded.max_staff, max_menus = excluded.max_menus,
  max_items = excluded.max_items, allows_dine_in = excluded.allows_dine_in,
  allows_waiter_service = excluded.allows_waiter_service,
  allows_deferred_payment = excluded.allows_deferred_payment,
  allows_online_ordering = excluded.allows_online_ordering,
  allows_kitchen_board = excluded.allows_kitchen_board,
  allows_pos = excluded.allows_pos, allows_promotions = excluded.allows_promotions,
  allows_coupons = excluded.allows_coupons,
  allows_staff_discounts = excluded.allows_staff_discounts,
  allows_menu_schedules = excluded.allows_menu_schedules,
  allows_inventory = excluded.allows_inventory,
  allows_loyalty = excluded.allows_loyalty;

-- One per restaurant. `goal` is how many visits earn the reward.
create table if not exists loyalty_programs (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null unique references restaurants(id) on delete cascade,
  active        boolean not null default false,
  goal          int not null default 8 check (goal between 2 and 50),
  reward        text not null default '' check (char_length(reward) <= 80),
  updated_at    timestamptz not null default now()
);

-- `code` is twelve Crockford base32 characters — 60 random bits, no I, L, O or
-- U to misread — printed on the card and carried by its QR. `goal` is the goal
-- the card was given: a restaurant that raises its goal does not move the
-- finish line on a card already on its way; the new one applies after the
-- card's next reward.
create table if not exists loyalty_cards (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  code          text not null unique check (code ~ '^[0-9A-HJKMNP-TV-Z]{12}$'),
  goal          int not null check (goal between 2 and 50),
  created_at    timestamptz not null default now()
);
create index if not exists loyalty_cards_restaurant_idx
  on loyalty_cards(restaurant_id, created_at desc);

-- One visit per card per day, in the restaurant's own time zone. The unique
-- key is the rule: a second scan the same day — a double tap, two waiters, a
-- race — adds nothing.
create table if not exists loyalty_visits (
  id            uuid primary key default gen_random_uuid(),
  card_id       uuid not null references loyalty_cards(id) on delete cascade,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  visit_day     date not null,
  actor_email   text not null,
  created_at    timestamptz not null default now(),
  unique (card_id, visit_day)
);
create index if not exists loyalty_visits_restaurant_idx
  on loyalty_visits(restaurant_id, created_at desc);

create table if not exists loyalty_redemptions (
  id            uuid primary key default gen_random_uuid(),
  card_id       uuid not null references loyalty_cards(id) on delete cascade,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  visits_used   int not null check (visits_used >= 0),
  reward        text not null,
  actor_email   text not null,
  created_at    timestamptz not null default now()
);
create index if not exists loyalty_redemptions_card_idx on loyalty_redemptions(card_id);

-- Server only. Every read and write goes through a route that checks who is
-- asking and scopes it to their restaurant; a browser key reads none of it.
alter table loyalty_programs    enable row level security;
alter table loyalty_cards       enable row level security;
alter table loyalty_visits      enable row level security;
alter table loyalty_redemptions enable row level security;
revoke all on loyalty_programs from anon, authenticated;
revoke all on loyalty_cards from anon, authenticated;
revoke all on loyalty_visits from anon, authenticated;
revoke all on loyalty_redemptions from anon, authenticated;

-- The reward ladder: several steps on one card — 4 visits a coffee, 8 a
-- dessert, 12 a meal — each redeemed once per round, in order. The last step's
-- visits are the round: redeeming it spends them and the card starts over,
-- extra visits carrying across. A step in the middle spends none.
--
-- `steps` is `[{visits, reward}]`, strictly increasing, one to four of them. A
-- card keeps the ladder its round started with, as it kept its goal, so a
-- program edited mid-round does not move anybody's finish line. `goal` stays,
-- and is always the last step's visits: the round's length. `round_no` counts
-- a card's rounds; a redemption carries the round it was spent in, so "already
-- redeemed this round" is an equality, not a guess from timestamps.
create or replace function public.loyalty_steps_ok(p_steps jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  -- CASE, not AND: SQL may evaluate AND's sides in any order, and a cast of
  -- "4.5" to int raises instead of answering false.
  select case
    when jsonb_typeof(p_steps) is distinct from 'array' then false
    when jsonb_array_length(p_steps) > 4 then false
    else coalesce((
      select bool_and(case
        when jsonb_typeof(s->'visits') is distinct from 'number'
          or jsonb_typeof(s->'reward') is distinct from 'string' then false
        when (s->>'visits') !~ '^[0-9]{1,2}$' then false
        when (s->>'visits')::int not between 2 and 50 then false
        when char_length(s->>'reward') not between 1 and 80 then false
        when i = 1 then true
        when jsonb_typeof(p_steps->(i::int - 2)->'visits') is distinct from 'number'
          or (p_steps->(i::int - 2)->>'visits') !~ '^[0-9]{1,2}$' then false
        else (s->>'visits')::int > (p_steps->(i::int - 2)->>'visits')::int
      end)
      from jsonb_array_elements(p_steps) with ordinality as e(s, i)), true)
  end
$$;

alter table loyalty_programs    add column if not exists steps jsonb not null default '[]'::jsonb;
alter table loyalty_cards       add column if not exists steps jsonb;
alter table loyalty_cards       add column if not exists round_no int not null default 0;
-- When the card's own ladder last changed, and when its diner last saved the
-- picture of it. The picture lists the rewards, and a card takes new ones only
-- when a round closes, so a picture saved before that shows rewards the card
-- no longer has: /rewards asks for it to be saved again. Both start at the
-- same moment, so no card made before them is asked.
alter table loyalty_cards       add column if not exists ladder_at timestamptz not null default now();
alter table loyalty_cards       add column if not exists saved_at timestamptz not null default now();
alter table loyalty_redemptions add column if not exists step int;
alter table loyalty_redemptions add column if not exists round_no int;
-- A step in the middle spends no visits, so zero is a real amount now.
alter table loyalty_redemptions drop constraint if exists loyalty_redemptions_visits_used_check;
alter table loyalty_redemptions add constraint loyalty_redemptions_visits_used_check check (visits_used >= 0);

-- A program saved before the ladder keeps `steps` empty and reads as a ladder
-- of one — its goal and its reward — everywhere it is read. It is deliberately
-- not backfilled: the code deployed before the ladder writes a program as a
-- goal and a reward, and a backfilled ladder would make that write break the
-- check below in the minutes between migrating and deploying.
--
-- A card is snapshotted, because a card keeps the rewards its round started
-- with: it takes the reward its program promises now, not whatever the
-- program says after its owner edits it. A card whose program has no reward
-- stays empty and reads the program's, as every card did before.
update loyalty_cards c
   set steps = jsonb_build_array(jsonb_build_object('visits', c.goal, 'reward', p.reward))
  from loyalty_programs p
 where p.restaurant_id = c.restaurant_id and c.steps is null and p.reward <> '';

-- What finally refuses a ladder the route would not have saved: out of order,
-- out of bounds, too many, a step with no reward, or a goal that is not the
-- last step's visits.
alter table loyalty_programs drop constraint if exists loyalty_programs_steps_check;
alter table loyalty_programs add constraint loyalty_programs_steps_check check (
  public.loyalty_steps_ok(steps)
  and (steps = '[]'::jsonb or (goal = (steps->-1->>'visits')::int and reward = steps->-1->>'reward')));
alter table loyalty_cards drop constraint if exists loyalty_cards_steps_check;
alter table loyalty_cards add constraint loyalty_cards_steps_check check (
  steps is null
  or (public.loyalty_steps_ok(steps) and jsonb_array_length(steps) > 0 and goal = (steps->-1->>'visits')::int));

-- Where a card stands: visits not yet spent on a reward, against its goal.
create or replace function public.loyalty_progress(p_card uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*)::int from loyalty_visits where card_id = p_card)
       - coalesce((select sum(visits_used)::int from loyalty_redemptions where card_id = p_card), 0);
$$;
revoke all on function public.loyalty_progress(uuid) from public, anon, authenticated;
grant execute on function public.loyalty_progress(uuid) to service_role;

-- Record today's visit on a card. The card row is locked, so two scans racing
-- are served one after the other; the unique key does the rest. Returns
-- nothing when the card is not this restaurant's, the program is off, or the
-- plan does not include loyalty — checked here as well as in the route, so a
-- route that forgot cannot stamp for a restaurant that has not paid for it.
create or replace function public.loyalty_stamp(p_restaurant uuid, p_code text, p_actor text)
returns table (card_id uuid, progress int, goal int, stamped boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card     loyalty_cards%rowtype;
  v_day      date;
  v_inserted int;
begin
  if not exists (
    select 1
      from loyalty_programs p
      join restaurants r on r.id = p.restaurant_id
      join plan_limits l on l.plan = r.plan
     where p.restaurant_id = p_restaurant and p.active and l.allows_loyalty
  ) then
    return;
  end if;

  select * into v_card from loyalty_cards c
   where c.code = p_code and c.restaurant_id = p_restaurant
   for update;
  if not found then return; end if;

  select (now() at time zone coalesce(r.timezone, 'America/Mexico_City'))::date into v_day
    from restaurants r where r.id = p_restaurant;

  insert into loyalty_visits (card_id, restaurant_id, visit_day, actor_email)
  values (v_card.id, p_restaurant, v_day, p_actor)
  on conflict on constraint loyalty_visits_card_id_visit_day_key do nothing;
  get diagnostics v_inserted = row_count;

  return query select v_card.id, public.loyalty_progress(v_card.id), v_card.goal, v_inserted = 1;
end;
$$;
revoke all on function public.loyalty_stamp(uuid, text, text) from public, anon, authenticated;
grant execute on function public.loyalty_stamp(uuid, text, text) to service_role;

-- Take back a stamp given by mistake: today's only, and not once a reward has
-- been spent after it — that visit is then part of the record the reward was
-- earned on, and taking it back left the card owing visits (a count below
-- zero that every screen showed as nought). Locked on the card like the stamp
-- and the redemption, so an undo and a redemption at the same instant cannot
-- both go through. Answers what happened: done, gone, old or spent.
create or replace function public.loyalty_unstamp(p_restaurant uuid, p_visit uuid, p_today date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card  uuid;
  v_visit loyalty_visits%rowtype;
begin
  select v.card_id into v_card from loyalty_visits v
   where v.id = p_visit and v.restaurant_id = p_restaurant;
  if not found then return 'gone'; end if;
  perform 1 from loyalty_cards c where c.id = v_card for update;

  -- Read again under the lock: another undo may have taken it meanwhile.
  select * into v_visit from loyalty_visits v
   where v.id = p_visit and v.restaurant_id = p_restaurant;
  if not found then return 'gone'; end if;
  if v_visit.visit_day <> p_today then return 'old'; end if;
  if exists (select 1 from loyalty_redemptions r
              where r.card_id = v_visit.card_id and r.created_at >= v_visit.created_at) then
    return 'spent';
  end if;

  delete from loyalty_visits v where v.id = p_visit;
  return 'done';
end;
$$;
revoke all on function public.loyalty_unstamp(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.loyalty_unstamp(uuid, uuid, date) to service_role;

-- Spend the card's next reward, once. Locked like the stamp, and refused —
-- nothing returned — unless that reward is ready. The next reward is the lowest
-- step of the card's ladder with no redemption in the card's current round
-- (`round_no`, carried on each redemption). The last step spends the round's
-- visits and the card takes the program's current ladder for its next round;
-- a step in the middle spends none. A reward already earned is honoured even if
-- the program was switched off or the plan changed since: the diner did their
-- part. With a ladder of one step this is exactly the old rule: reach the goal,
-- spend it, carry the rest.
-- `p_step` is the reward the waiter was shown — its visits — and the redemption
-- is refused unless that is still the card's next one. A card with three
-- rewards ready would otherwise spend two of them on a double tap: the first
-- tap the coffee, the second the dessert nobody asked for. Null takes whatever
-- is next, which is what a caller from before the ladder meant.
drop function if exists public.loyalty_redeem(uuid, text, text);
create or replace function public.loyalty_redeem(p_restaurant uuid, p_code text, p_actor text, p_step int default null)
returns table (card_id uuid, progress int, goal int, reward text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card     loyalty_cards%rowtype;
  v_steps    jsonb;
  v_next     jsonb;
  v_visits   int;
  v_last     int;
  v_used     int;
  v_program  loyalty_programs%rowtype;
  v_goal     int;
begin
  select * into v_card from loyalty_cards c
   where c.code = p_code and c.restaurant_id = p_restaurant
   for update;
  if not found then return; end if;
  select * into v_program from loyalty_programs p where p.restaurant_id = p_restaurant;

  -- A card from before the ladder has none of its own: it is the one step its
  -- goal and the program's reward make.
  v_steps := coalesce(v_card.steps, jsonb_build_array(jsonb_build_object(
    'visits', v_card.goal, 'reward', coalesce(v_program.reward, ''))));
  v_last := (v_steps->-1->>'visits')::int;

  select s into v_next from jsonb_array_elements(v_steps) s
   where not exists (
     select 1 from loyalty_redemptions r
      where r.card_id = v_card.id
        and r.round_no = v_card.round_no
        and r.step = (s->>'visits')::int)
   order by (s->>'visits')::int
   limit 1;
  if v_next is null then return; end if;
  v_visits := (v_next->>'visits')::int;
  if p_step is not null and p_step <> v_visits then return; end if;
  if public.loyalty_progress(v_card.id) < v_visits then return; end if;

  v_used := case when v_visits = v_last then v_last else 0 end;
  insert into loyalty_redemptions (card_id, restaurant_id, visits_used, reward, actor_email, step, round_no)
  values (v_card.id, p_restaurant, v_used, coalesce(v_next->>'reward', ''), p_actor, v_visits, v_card.round_no);

  -- The last step closes the round: the card starts the next one on the
  -- program's ladder as it is now.
  v_goal := v_card.goal;
  if v_used > 0 then
    -- The program's ladder, or the one step a program from before the ladder
    -- makes; none at all if it has no reward written.
    v_steps := coalesce(nullif(v_program.steps, '[]'::jsonb), case when coalesce(v_program.reward, '') <> '' then
      jsonb_build_array(jsonb_build_object('visits', v_program.goal, 'reward', v_program.reward)) end);
    v_goal := coalesce((v_steps->-1->>'visits')::int, v_program.goal, v_card.goal);
    update loyalty_cards c set steps = v_steps, goal = v_goal, round_no = c.round_no + 1,
           ladder_at = case when c.steps is distinct from v_steps then now() else c.ladder_at end
     where c.id = v_card.id;
  end if;

  return query
    select v_card.id, public.loyalty_progress(v_card.id), v_goal, coalesce(v_next->>'reward', '');
end;
$$;
revoke all on function public.loyalty_redeem(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.loyalty_redeem(uuid, text, text, int) to service_role;

-- A handover belongs to the displayed round and step. Save its answer on the
-- redemption itself so a lost response can be retried even after later rounds.
alter table loyalty_redemptions add column if not exists request_key uuid;
alter table loyalty_redemptions add column if not exists request_result jsonb;
create unique index if not exists loyalty_redemptions_request_idx
  on loyalty_redemptions(card_id, request_key) where request_key is not null;

-- Keep loyalty_redeem's old signature for the deployed route during rollout.
-- A separate name also avoids ambiguous RPC overloads for the old caller.
create or replace function public.loyalty_redeem_once(
  p_restaurant uuid, p_code text, p_actor text, p_step int, p_round int, p_request_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card loyalty_cards%rowtype;
  v_prior loyalty_redemptions%rowtype;
  v_spent record;
  v_result jsonb;
  v_steps jsonb;
  v_reward text;
begin
  if p_step is null or p_step not between 2 and 50
     or p_round is null or p_round < 0 or p_request_key is null then
    return jsonb_build_object('error', 'invalidRequest');
  end if;
  select * into v_card from loyalty_cards c
   where c.code = p_code and c.restaurant_id = p_restaurant for update;
  if not found then return jsonb_build_object('error', 'notHere'); end if;

  -- Check replay before the current round: the original tap may have closed it.
  select * into v_prior from loyalty_redemptions r
   where r.card_id = v_card.id and r.request_key = p_request_key;
  if found then
    if v_prior.round_no <> p_round or v_prior.step <> p_step then
      return jsonb_build_object('error', 'invalidRequest');
    end if;
    return v_prior.request_result;
  end if;
  if v_card.round_no <> p_round then
    return jsonb_build_object('error', 'roundChanged');
  end if;

  -- Stamp, undo and both redemption callers all take this same card lock.
  select * into v_spent from public.loyalty_redeem(p_restaurant, p_code, p_actor, p_step);
  if not found then
    if exists (select 1 from loyalty_redemptions r
                where r.card_id = v_card.id and r.round_no = p_round and r.step = p_step) then
      return jsonb_build_object('error', 'alreadyRedeemed');
    end if;
    return jsonb_build_object('error', 'notReady');
  end if;

  select * into v_card from loyalty_cards c where c.id = v_card.id;
  select p.reward into v_reward from loyalty_programs p where p.restaurant_id = p_restaurant;
  v_steps := coalesce(v_card.steps, jsonb_build_array(jsonb_build_object(
    'visits', v_card.goal, 'reward', coalesce(v_reward, ''))));
  v_result := jsonb_build_object(
    'progress', v_spent.progress, 'goal', v_spent.goal, 'reward', v_spent.reward,
    'round_no', v_card.round_no, 'steps', v_steps,
    'done', coalesce((select jsonb_agg(r.step) from loyalty_redemptions r
                      where r.card_id = v_card.id and r.round_no = v_card.round_no), '[]'::jsonb));
  update loyalty_redemptions r set request_key = p_request_key, request_result = v_result
   where r.card_id = v_card.id and r.round_no = p_round and r.step = p_step;
  return v_result;
end;
$$;
revoke all on function public.loyalty_redeem_once(uuid, text, text, int, int, uuid) from public, anon, authenticated;
grant execute on function public.loyalty_redeem_once(uuid, text, text, int, int, uuid) to service_role;

-- ── Customer accounts ("cuenta abierta") ───────────────────────────────────
-- A customer the restaurant trusts to pay later: food goes out now and is paid
-- for in one go, any day, online or at the till. It is credit the restaurant
-- extends, so every account has a ceiling set by whoever opened it, and only
-- the staff put things on it — the customer asks, the waiter or the cashier
-- charges, and that act is the approval on the record.
--
-- An order on an account is delivered and not paid: `paid` stays false (no
-- money has arrived) and `account_id` says who owes it. Every reader of unpaid
-- orders that means "the table owes this" must leave these out — a table billed
-- for a dish already on somebody's account is charged twice.
alter table plan_limits add column if not exists allows_open_accounts boolean not null default false;
update plan_limits set allows_open_accounts = (plan in ('caja', 'servicio', 'casa', 'grupo'));

create table if not exists customer_accounts (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references restaurants(id) on delete cascade,
  name           text not null check (char_length(btrim(name)) between 1 and 80),
  -- Only to send the statement, and only if the customer gives it.
  email          text check (email is null or char_length(email) <= 254),
  -- The statement's key, on its QR: twelve Crockford base32 characters, the
  -- visit card's alphabet. Holding it shows the statement and pays it.
  code           text not null unique check (code ~ '^[0-9A-HJKMNP-TV-Z]{12}$'),
  credit_limit   numeric not null check (credit_limit > 0 and credit_limit <= 1000000),
  status         text not null default 'open' check (status in ('open', 'closed')),
  opened_by      text not null,
  opened_at      timestamptz not null default now(),
  closed_by      text,
  closed_at      timestamptz,
  -- An online payment under way: nobody collects the same balance in person
  -- until it lands or its session runs out.
  checkout_until timestamptz
);
create index if not exists customer_accounts_restaurant_idx
  on customer_accounts(restaurant_id, status, name);
-- Read and written with the secret key only, by routes that check who is
-- asking first. The same as the visit cards.
alter table customer_accounts enable row level security;
revoke all on customer_accounts from anon, authenticated;

-- No `on delete`: an account is closed, never deleted, while it has orders;
-- deleting the restaurant takes both, and the check waits for the end of it.
alter table orders add column if not exists account_id uuid references customer_accounts(id);
alter table orders add column if not exists charged_by text;
alter table orders add column if not exists charged_at timestamptz;
create index if not exists orders_account_idx on orders(account_id) where account_id is not null;

alter table payments add column if not exists account_id uuid references customer_accounts(id) on delete set null;
create index if not exists payments_account_idx on payments(account_id) where account_id is not null;

-- A table whose bill went onto an account closes like a paid one.
alter table table_sessions drop constraint if exists table_sessions_close_reason_check;
alter table table_sessions add constraint table_sessions_close_reason_check
  check (close_reason in ('paid', 'settled', 'written_off', 'expired', 'account'));

-- An online payment of an account: exactly the orders owed when it started,
-- so a dish charged while the customer was on the card form is not paid for by
-- a card that never saw it.
create table if not exists account_checkouts (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references restaurants(id) on delete cascade,
  account_id        uuid not null references customer_accounts(id) on delete cascade,
  order_ids         uuid[] not null,
  amount            numeric not null check (amount > 0),
  tip               numeric not null default 0 check (tip >= 0),
  -- Our cut of this payment, recorded on an order once the money is real so
  -- the monthly ceiling is summed from what was taken.
  fee               numeric not null default 0 check (fee >= 0),
  stripe_session_id text unique,
  status            text not null default 'open' check (status in ('open', 'paid', 'expired')),
  created_at        timestamptz not null default now()
);
alter table account_checkouts enable row level security;
revoke all on account_checkouts from anon, authenticated;

-- A Stripe signature names its sender, not who was meant to receive the food.
-- Only sessions we created can reach the diner ledger; metadata is a snapshot,
-- never authority supplied by a connected account's owner.
create table if not exists diner_checkouts (
  id uuid primary key default gen_random_uuid(),
  stripe_session_id text not null unique,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  stripe_account_id text not null,
  livemode boolean not null,
  currency text not null check (currency in ('MXN', 'USD')),
  amount_cents integer not null check (amount_cents >= 0),
  metadata jsonb not null,
  order_ids uuid[] not null check (cardinality(order_ids) > 0),
  stripe_payment_intent text unique,
  created_at timestamptz not null default now()
);
alter table diner_checkouts enable row level security;
revoke all on diner_checkouts from public;
revoke all on diner_checkouts from anon;
revoke all on diner_checkouts from authenticated;
grant select, insert, update on diner_checkouts to service_role;

-- A quote exists before Stripe answers, so its session id starts empty.
alter table diner_checkouts alter column stripe_session_id drop not null;
alter table diner_checkouts add column if not exists status text not null default 'open' check (status in ('open', 'paid', 'expired'));
alter table diner_checkouts add column if not exists scope_key text;
alter table diner_checkouts add column if not exists payable_order_ids uuid[] not null default '{}';
alter table diner_checkouts add column if not exists idempotency_key text unique;
alter table diner_checkouts add column if not exists stripe_params jsonb;
alter table diner_checkouts add column if not exists entitlements jsonb not null default '{}';
alter table diner_checkouts add column if not exists order_discounts jsonb not null default '{}';
alter table diner_checkouts add column if not exists discount_applied boolean not null default false;
alter table diner_checkouts add column if not exists food_principal numeric not null default 0 check (food_principal >= 0);
create unique index if not exists diner_checkout_open_scope on diner_checkouts(restaurant_id, scope_key) where status = 'open';
alter table coupon_redemptions add column if not exists checkout_attempt_id uuid references diner_checkouts(id);
create index if not exists coupon_checkout_attempt on coupon_redemptions(checkout_attempt_id);
alter table bill_splits add column if not exists food_principal numeric;

-- No currency conversion happens anywhere in diner checkout. Refuse an old
-- unsupported value rather than silently relabelling somebody's money.
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.restaurants'::regclass
    and conname = 'restaurants_diner_currency') then
    alter table restaurants add constraint restaurants_diner_currency check (currency in ('MXN', 'USD'));
  end if;
end $$;

alter table customer_accounts add column if not exists checkout_id uuid;
-- Keep a hold opened before this column was added, without extending it.
update customer_accounts a set checkout_id = (
  select c.id from account_checkouts c where c.account_id = a.id and c.status = 'open'
   order by c.created_at desc, c.id desc limit 1
) where a.checkout_until is not null and a.checkout_id is null;

-- Waived food is no longer debt, even if an older write-off left it on an account.
create or replace function public.account_owed(p_account uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(total), 0) from orders
   where account_id = p_account and paid = false and written_off = false and status <> 'cancelled';
$$;
revoke all on function public.account_owed(uuid) from public, anon, authenticated;
grant execute on function public.account_owed(uuid) to service_role;

-- Puts orders on an account: a table's bill or a sale at the till. Under the
-- account's lock, so two charges at once cannot pass its ceiling together.
-- `p_expected` is the amount the person was shown: a bill that changed since
-- is refused rather than charged at a number nobody saw.
create or replace function public.account_charge(
  p_restaurant uuid,
  p_account    uuid,
  p_orders     uuid[],
  p_expected   numeric,
  p_actor      text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_account  customer_accounts;
  v_count    int;
  v_amount   numeric;
  v_sessions uuid[];
  v_owed     numeric;
begin
  perform public.lock_restaurant_money(p_restaurant);
  select * into v_account from customer_accounts
   where id = p_account and restaurant_id = p_restaurant for update;
  if v_account.id is null or v_account.status <> 'open' then
    return jsonb_build_object('outcome', 'closed');
  end if;
  if p_orders is null or cardinality(p_orders) = 0 then
    return jsonb_build_object('outcome', 'stale');
  end if;

  perform 1 from orders where id = any(p_orders) order by id for update;

  -- A card checkout open on any of them: the diner is paying it right now.
  if exists (select 1 from orders where id = any(p_orders)
              and card_checkout_at is not null and card_checkout_at > now() - interval '35 minutes'
              and paid = false) then
    return jsonb_build_object('outcome', 'paying');
  end if;

  select count(*), coalesce(sum(total), 0),
         array_agg(distinct session_id) filter (where session_id is not null)
    into v_count, v_amount, v_sessions
    from orders
   where id = any(p_orders)
     and restaurant_id = p_restaurant
     and paid = false and written_off = false and account_id is null
     and status not in ('cancelled', 'pending_payment');
  if v_count <> cardinality(p_orders) or abs(v_amount - p_expected) > 0.005 then
    return jsonb_build_object('outcome', 'stale');
  end if;

  -- Part of the table's bill already collected, or a division under way: the
  -- orders cannot move whole, and the account would owe what was paid.
  if exists (select 1 from payments where session_id = any(coalesce(v_sessions, '{}')) and order_id is null)
     or exists (select 1 from bill_splits where session_id = any(coalesce(v_sessions, '{}'))
                 and status in ('proposed', 'locked')) then
    return jsonb_build_object('outcome', 'partly_paid');
  end if;

  v_owed := public.account_owed(p_account);
  if v_owed + v_amount > v_account.credit_limit then
    return jsonb_build_object('outcome', 'limit', 'owed', v_owed, 'limit', v_account.credit_limit);
  end if;

  update orders set account_id = p_account, charged_by = p_actor, charged_at = now()
   where id = any(p_orders);
  perform public.close_session_if_clear(s, 'account') from unnest(coalesce(v_sessions, '{}')) s;

  return jsonb_build_object('outcome', 'charged', 'amount', v_amount, 'owed', v_owed + v_amount);
end;
$$;
revoke all on function public.account_charge(uuid, uuid, uuid[], numeric, text) from public, anon, authenticated;
grant execute on function public.account_charge(uuid, uuid, uuid[], numeric, text) to service_role;

-- A ceiling or closure must see every charge that won the account lock first.
create or replace function public.account_change(
  p_restaurant uuid, p_account uuid, p_action text, p_limit numeric, p_actor text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_account customer_accounts;
  v_owed numeric;
begin
  perform public.lock_restaurant_money(p_restaurant);
  select * into v_account from customer_accounts
   where id = p_account and restaurant_id = p_restaurant for update;
  if v_account.id is null then return jsonb_build_object('outcome', 'missing'); end if;
  v_owed := public.account_owed(p_account);
  if p_action = 'limit' then
    if p_limit is null or p_limit <= 0 or p_limit > 1000000 then
      return jsonb_build_object('outcome', 'invalid');
    end if;
    if p_limit < v_owed then return jsonb_build_object('outcome', 'limit', 'owed', v_owed); end if;
    update customer_accounts set credit_limit = p_limit where id = p_account;
  elsif p_action = 'close' then
    if v_owed > 0 then return jsonb_build_object('outcome', 'owes', 'owed', v_owed); end if;
    update customer_accounts set status = 'closed', closed_by = p_actor, closed_at = now() where id = p_account;
  else
    return jsonb_build_object('outcome', 'invalid');
  end if;
  return jsonb_build_object('outcome', 'changed', 'previous_limit', v_account.credit_limit);
end;
$$;
revoke all on function public.account_change(uuid, uuid, text, numeric, text) from public, anon, authenticated;
grant execute on function public.account_change(uuid, uuid, text, numeric, text) to service_role;

-- Collects everything an account owes, in person. `p_expected` is the balance
-- the cashier was shown; `p_ref` makes a retried tap the same collection.
create or replace function public.account_settle(
  p_restaurant uuid,
  p_account    uuid,
  p_expected   numeric,
  p_tip        numeric,
  p_method     text,
  p_actor      text,
  p_ref        text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_account customer_accounts;
  v_ids     uuid[];
  v_owed    numeric;
  v_tip     numeric := greatest(coalesce(p_tip, 0), 0);
begin
  perform public.lock_restaurant_money(p_restaurant);
  select * into v_account from customer_accounts
   where id = p_account and restaurant_id = p_restaurant for update;
  if v_account.id is null then return jsonb_build_object('outcome', 'missing'); end if;
  if p_ref is not null and exists (select 1 from payments
                                    where restaurant_id = p_restaurant and client_ref = p_ref) then
    return jsonb_build_object('outcome', 'duplicate');
  end if;
  if v_account.checkout_until is not null and v_account.checkout_until > now() then
    return jsonb_build_object('outcome', 'paying');
  end if;

  perform 1 from orders where account_id = p_account and paid = false and written_off = false and status <> 'cancelled' order by id for update;
  select coalesce(sum(total), 0), array_agg(id order by created_at desc)
    into v_owed, v_ids
    from orders where account_id = p_account and paid = false and written_off = false and status <> 'cancelled';
  if v_owed <= 0 then return jsonb_build_object('outcome', 'nothing'); end if;
  if abs(v_owed - p_expected) > 0.005 then
    return jsonb_build_object('outcome', 'changed', 'owed', v_owed);
  end if;
  -- A gratuity is never more than what it thanks somebody for.
  v_tip := least(v_tip, v_owed);

  insert into payments (restaurant_id, account_id, amount, tip, method, actor_email, client_ref)
  values (p_restaurant, p_account, v_owed + v_tip, v_tip, p_method, p_actor, p_ref);
  update orders set paid = true, pay_method = p_method where id = any(v_ids);
  -- The gratuity lands on the latest order, as a table's does on its first.
  if v_tip > 0 then
    update orders set tip = tip + v_tip, total = total + v_tip where id = v_ids[1];
  end if;
  return jsonb_build_object('outcome', 'paid', 'amount', v_owed + v_tip, 'tip', v_tip);
end;
$$;
revoke all on function public.account_settle(uuid, uuid, numeric, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.account_settle(uuid, uuid, numeric, numeric, text, text, text) to service_role;

-- Starts an online payment of an account: the orders owed now, held so the
-- till does not collect them while the customer is on the card form.
create or replace function public.account_checkout_open(
  p_restaurant uuid,
  p_account    uuid,
  p_expected   numeric,
  p_tip        numeric,
  p_fee        numeric
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_account customer_accounts;
  v_ids     uuid[];
  v_owed    numeric;
  v_tip     numeric := greatest(coalesce(p_tip, 0), 0);
  v_id      uuid;
begin
  perform public.lock_restaurant_money(p_restaurant);
  select * into v_account from customer_accounts
   where id = p_account and restaurant_id = p_restaurant for update;
  if v_account.id is null then return jsonb_build_object('outcome', 'missing'); end if;
  if v_account.checkout_until is not null and v_account.checkout_until > now() then
    return jsonb_build_object('outcome', 'paying');
  end if;
  perform 1 from orders where account_id = p_account and paid = false
    and written_off = false and status <> 'cancelled' order by id for update;
  select coalesce(sum(total), 0), array_agg(id order by created_at desc)
    into v_owed, v_ids
    from orders where account_id = p_account and paid = false and written_off = false and status <> 'cancelled';
  if v_owed <= 0 then return jsonb_build_object('outcome', 'nothing'); end if;
  if abs(v_owed - p_expected) > 0.005 then
    return jsonb_build_object('outcome', 'changed', 'owed', v_owed);
  end if;
  -- A checkout still open once its hold has lapsed is dead: its Stripe session
  -- expired at thirty minutes, five before the hold. Closed here, so its
  -- expiry arriving late (Stripe retries for days) finds nothing to release.
  -- Releasing it lifted the hold of the checkout opened now, and the till
  -- could collect the account while the customer was paying it by card.
  update account_checkouts set status = 'expired' where account_id = p_account and status = 'open';
  v_tip := least(v_tip, v_owed);
  insert into account_checkouts (restaurant_id, account_id, order_ids, amount, tip, fee)
  values (p_restaurant, p_account, v_ids, v_owed, v_tip, greatest(coalesce(p_fee, 0), 0)) returning id into v_id;
  update customer_accounts set checkout_until = now() + interval '35 minutes', checkout_id = v_id where id = p_account;
  return jsonb_build_object('outcome', 'open', 'checkout', v_id, 'amount', v_owed, 'tip', v_tip);
end;
$$;
revoke all on function public.account_checkout_open(uuid, uuid, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.account_checkout_open(uuid, uuid, numeric, numeric, numeric) to service_role;

-- The card payment landed (Stripe's webhook): the orders it was opened for are
-- paid, the ledger has the money, the hold is lifted. Once: a repeated event
-- finds the checkout already paid and changes nothing.
create or replace function public.account_checkout_settle(
  p_checkout uuid,
  p_intent   text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_checkout account_checkouts;
  v_account  customer_accounts;
  v_ids      uuid[];
  v_still    numeric;
  v_food     numeric;
  v_tip      numeric;
  v_twice    numeric;
begin
  perform public.lock_restaurant_money((select restaurant_id from account_checkouts where id = p_checkout));
  select * into v_checkout from account_checkouts where id = p_checkout;
  if v_checkout.id is null then return jsonb_build_object('outcome', 'missing'); end if;
  -- Opening the next checkout holds the account first too.
  select * into v_account from customer_accounts where id = v_checkout.account_id for update;
  select * into v_checkout from account_checkouts where id = p_checkout for update;
  if v_checkout.status = 'paid' then return jsonb_build_object('outcome', 'duplicate'); end if;

  -- Freeze each order before summing it: a cancel or discount must not commit
  -- between the amount read and the paid flag written below.
  perform 1 from orders where id = any(v_checkout.order_ids)
    and paid = false and written_off = false and status <> 'cancelled' order by id for update;

  -- The ones still owed. The hold keeps the till off them while the customer
  -- is on Stripe's page, but a payment whose webhook arrives after the hold
  -- ran out can find the till collected some or all of them meanwhile.
  select array_agg(id order by created_at desc), coalesce(sum(total), 0) into v_ids, v_still
    from orders where id = any(v_checkout.order_ids) and paid = false and written_off = false and status <> 'cancelled';
  v_food := least(v_checkout.amount, v_still);
  v_tip := case when v_ids is null then 0 else v_checkout.tip end;
  if v_food + v_tip > 0 then
    insert into payments (restaurant_id, account_id, amount, tip, method, stripe_payment_intent)
    values (v_checkout.restaurant_id, v_checkout.account_id, v_food + v_tip, v_tip, 'card', p_intent);
  end if;
  -- What the card paid for food already paid another way is the customer's
  -- money taken twice: kept as a refund due, out of the ledger, and the bell
  -- says so — the same as a card payment landing on a table already settled.
  v_twice := round(v_checkout.amount + v_checkout.tip - v_food - v_tip, 2);
  if v_twice > 0 and p_intent is not null then
    insert into refunds_due (restaurant_id, stripe_payment_intent, amount, order_ids, account_name)
    values (v_checkout.restaurant_id, p_intent, v_twice, v_checkout.order_ids, v_account.name)
    on conflict (stripe_payment_intent) do nothing;
    if found then
      insert into notifications (restaurant_id, kind, data)
      values (v_checkout.restaurant_id, 'refund_due',
              jsonb_build_object('amount', v_twice, 'currency', (select currency from restaurants where id = v_checkout.restaurant_id),
                                 'account', v_account.name));
    end if;
  end if;
  update orders set paid = true, pay_method = 'card' where id = any(coalesce(v_ids, '{}'));
  if v_checkout.tip > 0 and v_ids is not null then
    update orders set tip = tip + v_checkout.tip, total = total + v_checkout.tip where id = v_ids[1];
  end if;
  -- Our fee is taken in `platform_fees` by the webhook; `orders.platform_fee`
  -- is the frozen record of fees from before that ledger.
  update account_checkouts set status = 'paid' where id = p_checkout;
  update customer_accounts set checkout_until = null, checkout_id = null
   where id = v_checkout.account_id and checkout_id = p_checkout;
  return jsonb_build_object('outcome', 'paid', 'orders', coalesce(cardinality(v_ids), 0));
end;
$$;
revoke all on function public.account_checkout_settle(uuid, text) from public, anon, authenticated;
grant execute on function public.account_checkout_settle(uuid, text) to service_role;

-- The customer walked away from Stripe, or the session could not be made: an
-- open checkout is closed and its hold lifted, in one transaction. One that is
-- not open any more (paid, or closed when the next checkout opened) is left
-- alone — releasing it would lift the hold of whatever holds the account now.
create or replace function public.account_checkout_release(p_checkout uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_account uuid;
begin
  select account_id into v_account from account_checkouts where id = p_checkout;
  if v_account is null then return; end if;
  perform 1 from customer_accounts where id = v_account for update;
  update account_checkouts set status = 'expired'
   where id = p_checkout and status = 'open';
  if found then
    update customer_accounts set checkout_until = null, checkout_id = null
     where id = v_account and checkout_id = p_checkout;
  end if;
end;
$$;
revoke all on function public.account_checkout_release(uuid) from public, anon, authenticated;
grant execute on function public.account_checkout_release(uuid) to service_role;

-- The cash drawer's own movements: the money a day starts with, and the money
-- taken out during it. Neither is a sale, so neither belongs in `payments` —
-- but the register close cannot say what the drawer should hold without them:
-- what it started with, plus the cash taken, minus what was taken out. Card
-- and online money has no float, so only cash has these.
--
-- Openings now belong to cash_shifts: the 'opening' kind is no longer
-- written. Withdrawals carry the shift they were taken in.
-- Written and read only by the server, scoped to the restaurant there.
create table if not exists cash_movements (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  kind          text not null check (kind in ('opening', 'withdrawal')),
  amount        numeric not null check (amount >= 0 and amount <= 1000000),
  note          text check (note is null or char_length(note) <= 140),
  actor_email   text not null,
  created_at    timestamptz not null default now()
);
-- A withdrawal of nothing is not one; an opening of nothing is an empty drawer.
alter table cash_movements drop constraint if exists cash_movements_withdrawal_positive;
alter table cash_movements add constraint cash_movements_withdrawal_positive
  check (kind <> 'withdrawal' or amount > 0);
create index if not exists cash_movements_day_idx on cash_movements(restaurant_id, created_at);
alter table cash_movements enable row level security;
revoke all on cash_movements from anon;
revoke all on cash_movements from authenticated;
grant all on cash_movements to service_role;

-- A shift at the cash drawer: opened with the cash it starts with, closed by
-- somebody who counted it. The count is entered before the expected amount is
-- shown and cannot be changed afterwards — a count adjusted after seeing the
-- answer is not a count. A difference is explained, by the person who closed
-- or a manager, and the explanation stays with the shift.
--
-- One open shift per restaurant: there is one drawer. Withdrawals belong to
-- the open shift (cash_movements.shift_id). The expected amount is worked out
-- by the server at the moment of the count and stored, so a record struck off
-- or a payment refunded later cannot rewrite what the shift was closed on.
-- Server-only, like the drawer's movements.
create table if not exists cash_shifts (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references restaurants(id) on delete cascade,
  opened_by       text not null,
  opened_at       timestamptz not null default now(),
  opening_amount  numeric not null check (opening_amount >= 0 and opening_amount <= 1000000),
  closed_by       text,
  closed_at       timestamptz,
  counted_cash    numeric check (counted_cash >= 0 and counted_cash <= 1000000),
  expected_cash   numeric,
  difference      numeric,
  difference_note text check (difference_note is null or char_length(difference_note) <= 280),
  explained_by    text,
  check ((closed_at is null) = (closed_by is null)),
  check ((closed_at is null) = (counted_cash is null))
);
create unique index if not exists cash_shifts_one_open on cash_shifts(restaurant_id) where closed_at is null;
create index if not exists cash_shifts_day_idx on cash_shifts(restaurant_id, opened_at desc);
alter table cash_shifts enable row level security;
revoke all on cash_shifts from anon;
revoke all on cash_shifts from authenticated;
grant all on cash_shifts to service_role;
alter table cash_movements add column if not exists shift_id uuid references cash_shifts(id) on delete cascade;
create index if not exists cash_movements_shift_idx on cash_movements(shift_id);
-- Stations: where a section's dishes are made. A café makes drinks at the
-- bar and food in the kitchen, and one ticket holds both — so each order line
-- carries its station (copied from its section when the order is written,
-- like `skipsKitchen`), each station marks its own part ready, and the order
-- is ready when every station it needs has. Splitting the order instead would
-- split the bill.
alter table categories add column if not exists station text not null default 'kitchen';
alter table categories drop constraint if exists categories_station_check;
alter table categories add constraint categories_station_check check (station in ('kitchen', 'bar'));
alter table orders add column if not exists stations_ready text[] not null default '{}';

-- One station's part of an order is ready. Under the order's lock, so the bar
-- and the kitchen finishing at the same moment both count. The order itself
-- becomes ready once every station its lines need is in.
create or replace function public.mark_station_ready(p_restaurant uuid, p_order uuid, p_station text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order  orders;
  v_needed text[];
  v_ready  text[];
begin
  if p_station not in ('kitchen', 'bar') then return jsonb_build_object('outcome', 'invalid'); end if;
  select * into v_order from orders where id = p_order and restaurant_id = p_restaurant for update;
  if v_order.id is null then return jsonb_build_object('outcome', 'missing'); end if;
  if v_order.written_off then return jsonb_build_object('outcome', 'inactive'); end if;
  if v_order.status not in ('received', 'preparing') then
    return jsonb_build_object('outcome', 'moved', 'status', v_order.status);
  end if;
  select coalesce(array_agg(distinct coalesce(i->>'station', 'kitchen')), '{}') into v_needed
    from jsonb_array_elements(coalesce(v_order.items, '[]'::jsonb)) i
   where not coalesce((i->>'skipsKitchen')::boolean, false);
  if not (p_station = any(v_needed)) then return jsonb_build_object('outcome', 'notHere'); end if;
  v_ready := array(select distinct unnest(v_order.stations_ready || p_station) order by 1);
  update orders
     set stations_ready = v_ready,
         status = case when v_needed <@ v_ready then 'ready' else 'preparing' end
   where id = p_order;
  return jsonb_build_object('outcome', 'ok', 'stations_ready', v_ready,
                            'status', case when v_needed <@ v_ready then 'ready' else 'preparing' end);
end;
$$;
revoke all on function public.mark_station_ready(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mark_station_ready(uuid, uuid, text) to service_role;

-- ── Last, on purpose ────────────────────────────────────────────────────────
-- The table-shaping privileges, taken from every table once more. The revoke
-- near the top only reaches tables that already exist when it runs, so a table
-- created further down kept TRUNCATE for signed-in accounts until the schema
-- was run a second time — and RLS does not guard TRUNCATE. refunds_due shipped
-- to production that way, and `pnpm prod:check` caught the difference.
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- Reservations remember what was actually taken, independently of later plan
-- changes. No order FK here: stock is reserved before the order is inserted.
create table if not exists stock_reservations (
  id uuid primary key,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  demand jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  released_at timestamptz
);
alter table stock_reservations enable row level security;
revoke all on stock_reservations from anon;
revoke all on stock_reservations from authenticated;
grant all on stock_reservations to service_role;
create index if not exists stock_reservations_pending_idx
  on stock_reservations(created_at) where released_at is null;
alter table orders add column if not exists stock_managed boolean not null default false;
alter table orders add column if not exists stock_reservation_id uuid
  references stock_reservations(id);
create unique index if not exists orders_stock_reservation_idx
  on orders(stock_reservation_id) where stock_reservation_id is not null;

-- Starting tracking again is a new count. An older reservation must not add
-- portions to a new physical count after tracking was switched off and on.
-- Numeric recounts do the same; only trusted sale, waste and return functions
-- keep the generation. Browser callers cannot give themselves that exemption.
alter table menu_items add column if not exists stock_epoch int not null default 0;
create or replace function public.stock_tracking_epoch()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_setting('tabletap.stock_movement', true) = 'on'
     and current_user not in ('anon', 'authenticated') then
    new.stock_epoch := old.stock_epoch;
  elsif new.stock is distinct from old.stock
     or (new.stock_epoch = old.stock_epoch + 1
       and current_setting('tabletap.stock_recount', true) = 'on'
       and current_user not in ('anon', 'authenticated')) then
    new.stock_epoch := old.stock_epoch + 1;
  else
    new.stock_epoch := old.stock_epoch;
  end if;
  return new;
end;
$$;
drop trigger if exists stock_tracking_epoch on menu_items;
create trigger stock_tracking_epoch before update on menu_items
  for each row execute function public.stock_tracking_epoch();
revoke all on function public.stock_tracking_epoch() from public, anon, authenticated;

-- The original three-argument function remains for a rolling deployment.
-- This overload records the exact tracked quantities under the same locks.
create or replace function public.reserve_stock(
  p_restaurant uuid, p_demand jsonb, p_threshold int, p_reservation uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_result jsonb;
  v_demand jsonb;
  v_existing stock_reservations%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_reservation::text, 0));
  select * into v_existing from stock_reservations where id = p_reservation;
  if found then
    if v_existing.restaurant_id <> p_restaurant or v_existing.released_at is not null then
      raise exception 'Reservation cannot be reused';
    end if;
    return v_existing.result;
  end if;
  perform 1 from menu_items m
   where m.restaurant_id = p_restaurant
     and m.id in (select item_id from jsonb_to_recordset(p_demand) as d(item_id uuid, qty int))
   order by m.id for update;
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', m.id, 'qty', d.qty, 'epoch', m.stock_epoch)), '[]'::jsonb)
    into v_demand
    from jsonb_to_recordset(p_demand) as d(item_id uuid, qty int)
    join menu_items m on m.id = d.item_id and m.restaurant_id = p_restaurant
   where m.stock is not null;
  v_result := reserve_stock(p_restaurant, p_demand, p_threshold);
  if (v_result->>'ok')::boolean then
    insert into stock_reservations(id, restaurant_id, demand, result)
    values (p_reservation, p_restaurant, v_demand, v_result);
  end if;
  return v_result;
end;
$$;
revoke all on function public.reserve_stock(uuid, jsonb, int, uuid) from public, anon, authenticated;
grant execute on function public.reserve_stock(uuid, jsonb, int, uuid) to service_role;

create or replace function public.release_stock_reservation(p_restaurant uuid, p_reservation uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_res stock_reservations%rowtype;
  v_item record;
begin
  -- A trusted stock movement: it keeps the dish's count generation.
  perform set_config('tabletap.stock_movement', 'on', true);
  select * into v_res from stock_reservations
   where id = p_reservation and restaurant_id = p_restaurant for update;
  if not found or v_res.released_at is not null then return; end if;
  if exists (select 1 from orders where stock_reservation_id = p_reservation and status <> 'cancelled') then
    raise exception 'A live order still owns this reservation';
  end if;
  for v_item in
    select m.id, d.qty from jsonb_to_recordset(v_res.demand) as d(item_id uuid, qty int, epoch int)
    join menu_items m on m.id = d.item_id
    where m.restaurant_id = p_restaurant and m.stock is not null and m.stock_epoch = d.epoch
    order by m.id for update of m
  loop
    update menu_items set stock = stock + v_item.qty,
      available = case when stock = 0 and stock_auto_off then true else available end,
      stock_auto_off = case when stock = 0 and stock_auto_off then false else stock_auto_off end
    where id = v_item.id;
  end loop;
  update stock_reservations set released_at = now() where id = p_reservation;
end;
$$;
revoke all on function public.release_stock_reservation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_stock_reservation(uuid, uuid) to service_role;

-- Binding and release share the reservation lock. A recovery worker cannot
-- return stock while an order is taking ownership of it.
create or replace function public.order_stock_reservation()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_res stock_reservations%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.stock_reservation_id is not null then
      select * into v_res from stock_reservations where id = new.stock_reservation_id for update;
      if not found or v_res.restaurant_id <> new.restaurant_id or v_res.released_at is not null then
        raise exception 'Invalid stock reservation';
      end if;
    end if;
    return new;
  end if;
  if not old.stock_managed and old.stock_reservation_id is null
     and old.status <> 'cancelled'
     and (tg_op = 'DELETE' or new.status = 'cancelled') then
    begin
      insert into user_logs(restaurant_id, actor_email, entity, action, detail)
        values(old.restaurant_id, coalesce(auth.jwt()->>'email', 'staff'), 'order', 'updated',
          'order=' || left(old.id::text, 8) || ' stock=unproven');
    exception when others then
      -- A missing activity row must not block a cancellation or change its money.
      raise warning 'Could not log unproven stock for order %', old.id;
    end;
  end if;
  if tg_op = 'DELETE' then
    perform release_stock_reservation(old.restaurant_id, old.stock_reservation_id);
    delete from stock_reservations where id = old.stock_reservation_id;
    return old;
  end if;
  if new.stock_reservation_id is distinct from old.stock_reservation_id
     or new.stock_managed is distinct from old.stock_managed then
    raise exception 'An order cannot change its stock reservation';
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    perform release_stock_reservation(new.restaurant_id, new.stock_reservation_id);
  end if;
  return new;
end;
$$;
drop trigger if exists bind_order_stock on orders;
create trigger bind_order_stock before insert on orders
  for each row execute function public.order_stock_reservation();
drop trigger if exists return_order_stock on orders;
create trigger return_order_stock after update or delete on orders
  for each row execute function public.order_stock_reservation();
revoke all on function public.order_stock_reservation() from public, anon, authenticated;

-- One transaction owns the order, removes its unconfirmed coupon use, returns
-- that use, and deletes the pending order (whose trigger returns its stock).
drop function if exists public.abandon_checkout(uuid, boolean);
create or replace function public.abandon_checkout(p_order uuid, p_delete_order boolean, p_legacy_demand jsonb default '[]'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_order orders%rowtype; v_coupon record;
begin
  select * into v_order from orders where id = p_order for update;
  if not found then return; end if;
  if p_delete_order and (v_order.paid or v_order.status <> 'pending_payment') then return; end if;
  for v_coupon in
    delete from coupon_redemptions where order_id = p_order and confirmed_at is null and checkout_attempt_id is null
    returning coupon_id
  loop
    if v_coupon.coupon_id is not null then perform release_coupon(v_coupon.coupon_id); end if;
  end loop;
  if p_delete_order then
    -- No deduction record exists for legacy lines; deletion must not invent stock.
    delete from orders where id = p_order;
  end if;
end;
$$;
revoke all on function public.abandon_checkout(uuid, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.abandon_checkout(uuid, boolean, jsonb) to service_role;

-- Compare-and-set version for subscription synchronization.
alter table restaurants add column if not exists subscription_sync_revision int not null default 0;

-- An interrupted request may have taken stock without inserting its order.
-- A grace period keeps ordinary requests out; the reservation lock and the
-- INSERT trigger prevent a late request from binding returned stock.
drop function if exists public.recover_stock_reservations();
create or replace function public.recover_stock_reservations(p_restaurant uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_res record; v_count int := 0;
begin
  for v_res in
    select r.id, r.restaurant_id from stock_reservations r
    where r.released_at is null and r.created_at < now() - interval '1 hour'
      and (p_restaurant is null or r.restaurant_id = p_restaurant)
      and not exists (select 1 from orders o where o.stock_reservation_id = r.id)
    order by r.id limit 1 for update of r skip locked
  loop
    -- Recheck after acquiring the lock: an insert could have just committed.
    if not exists (select 1 from orders where stock_reservation_id = v_res.id) then
      perform release_stock_reservation(v_res.restaurant_id, v_res.id);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.recover_stock_reservations(uuid) from public, anon, authenticated;
grant execute on function public.recover_stock_reservations(uuid) to service_role;

-- ── Costs: what each product actually leaves ───────────────────────────────
-- A café asked to know what it makes on each product: the coffee, the milk,
-- the cup and the lid behind a latte, and what the card took. That is a
-- contribution margin — what a sale leaves towards rent and wages — and never
-- the business's net profit, which has costs no recipe knows about.
--
-- On Casa and above. The tables are the restaurant's private books: written
-- and read only by the server, scoped to the restaurant there.
alter table plan_limits add column if not exists allows_costs boolean not null default false;
update plan_limits set allows_costs = (plan in ('casa', 'grupo'));

-- What the restaurant's own card terminal charges, as a share of the sale.
-- Stripe's own rate is known; a terminal's is whatever the owner signed for.
alter table restaurants add column if not exists terminal_fee_pct numeric not null default 3.5;
alter table restaurants drop constraint if exists restaurants_terminal_fee_pct_check;
alter table restaurants add constraint restaurants_terminal_fee_pct_check
  check (terminal_fee_pct >= 0 and terminal_fee_pct <= 15);

-- An ingredient is bought in packs (a 1 kg bag, a 1 l carton, a sleeve of 50
-- cups) and used in units (g, ml, pieces). What one unit costs follows from
-- the pack's price and size, so it is worked out here and never typed twice.
-- Removing one archives it: what was recorded against it stays true.
create table if not exists ingredients (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  unit          text not null check (unit in ('g', 'ml', 'pza')),
  pack_size     numeric not null check (pack_size > 0 and pack_size <= 1000000),
  pack_price    numeric not null check (pack_price >= 0 and pack_price <= 1000000),
  unit_cost     numeric generated always as (pack_price / pack_size) stored,
  supplier      text check (supplier is null or char_length(supplier) <= 80),
  updated_by    text not null,
  created_at    timestamptz not null default now(),
  archived_at   timestamptz
);
create unique index if not exists ingredients_one_name
  on ingredients(restaurant_id, lower(btrim(name))) where archived_at is null;
create index if not exists ingredients_restaurant_idx on ingredients(restaurant_id);
alter table ingredients enable row level security;
revoke all on ingredients from anon;
revoke all on ingredients from authenticated;
grant all on ingredients to service_role;

-- Every change of what a unit costs, kept, so a supplier's rise can be shown
-- with what it did to each product. Written by the trigger below, so no path
-- that changes a price can forget to.
create table if not exists ingredient_prices (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  previous_cost numeric,
  unit_cost     numeric not null,
  changed_by    text not null,
  created_at    timestamptz not null default now()
);
create index if not exists ingredient_prices_recent_idx on ingredient_prices(restaurant_id, created_at desc);
alter table ingredient_prices enable row level security;
revoke all on ingredient_prices from anon;
revoke all on ingredient_prices from authenticated;
grant all on ingredient_prices to service_role;

create or replace function public.record_ingredient_price()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.unit_cost is distinct from old.unit_cost then
    insert into ingredient_prices (restaurant_id, ingredient_id, previous_cost, unit_cost, changed_by)
    values (new.restaurant_id, new.id, case when tg_op = 'UPDATE' then old.unit_cost end, new.unit_cost, new.updated_by);
  end if;
  return new;
end;
$$;
revoke all on function public.record_ingredient_price() from public, anon, authenticated;
drop trigger if exists ingredient_price_history on ingredients;
create trigger ingredient_price_history after insert or update on ingredients
  for each row execute function public.record_ingredient_price();

-- A product's recipe: how much of each ingredient one goes out with. A line
-- with a choice applies only when that choice was made — the 200 ml of oat
-- milk belongs to "Leche: Avena" and not to every latte.
create table if not exists recipe_lines (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  item_id       uuid not null references menu_items(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  quantity      numeric not null check (quantity > 0 and quantity <= 100000),
  mod_label     text check (mod_label is null or char_length(mod_label) <= 80),
  mod_option    text check (mod_option is null or char_length(mod_option) <= 80),
  check ((mod_label is null) = (mod_option is null))
);
create index if not exists recipe_lines_item_idx on recipe_lines(item_id);
create index if not exists recipe_lines_restaurant_idx on recipe_lines(restaurant_id);
alter table recipe_lines enable row level security;
revoke all on recipe_lines from anon;
revoke all on recipe_lines from authenticated;
grant all on recipe_lines to service_role;

-- A recipe joins a product and an ingredient of the SAME restaurant. The
-- routes check it; this makes it true for any writer the routes do not know.
create or replace function public.recipe_line_same_restaurant()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from menu_items where id = new.item_id and restaurant_id = new.restaurant_id)
     or not exists (select 1 from ingredients where id = new.ingredient_id and restaurant_id = new.restaurant_id) then
    raise exception 'A recipe line belongs to one restaurant';
  end if;
  return new;
end;
$$;
revoke all on function public.recipe_line_same_restaurant() from public, anon, authenticated;
drop trigger if exists recipe_line_same_restaurant on recipe_lines;
create trigger recipe_line_same_restaurant before insert or update on recipe_lines
  for each row execute function public.recipe_line_same_restaurant();

-- A product's recipe is replaced whole, in one transaction: a recipe half
-- written is a margin that is wrong without anybody knowing. Returns how many
-- lines it holds, -1 when the product is not this restaurant's, -2 when an
-- ingredient is not (or is archived).
create or replace function public.replace_recipe(p_restaurant uuid, p_item uuid, p_lines jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare v_count int;
begin
  perform 1 from menu_items where id = p_item and restaurant_id = p_restaurant for update;
  if not found then return -1; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_lines) as l(ingredient_id uuid)
      left join ingredients i
        on i.id = l.ingredient_id and i.restaurant_id = p_restaurant and i.archived_at is null
     where i.id is null
  ) then return -2; end if;
  delete from recipe_lines where item_id = p_item and restaurant_id = p_restaurant;
  insert into recipe_lines (restaurant_id, item_id, ingredient_id, quantity, mod_label, mod_option)
  select p_restaurant, p_item, l.ingredient_id, l.quantity, l.mod_label, l.mod_option
    from jsonb_to_recordset(p_lines) as l(ingredient_id uuid, quantity numeric, mod_label text, mod_option text);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.replace_recipe(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_recipe(uuid, uuid, jsonb) to service_role;

-- Archiving an ingredient takes it out of every recipe at the same moment: a
-- recipe still counting an ingredient nobody buys any more is a cost made up.
create or replace function public.archive_ingredient(p_restaurant uuid, p_ingredient uuid, p_actor text)
returns int language plpgsql security definer set search_path = public as $$
declare v_lines int;
begin
  update ingredients set archived_at = now(), updated_by = p_actor
   where id = p_ingredient and restaurant_id = p_restaurant and archived_at is null;
  if not found then return -1; end if;
  delete from recipe_lines where ingredient_id = p_ingredient and restaurant_id = p_restaurant;
  get diagnostics v_lines = row_count;
  return v_lines;
end;
$$;
revoke all on function public.archive_ingredient(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.archive_ingredient(uuid, uuid, text) to service_role;

-- ── Waste, purchases and counts: what is used, and what to buy ─────────────
-- The second half of costs. What was thrown away and why; what came in from
-- a supplier and at what price; what a person counted on the shelf. With the
-- recipes and the orders, these say what the shelf should hold — and so what
-- to buy before it runs out. Server-only, like the rest of the books.

-- How many days a supplier takes to deliver it, and how many days of use a
-- purchase should cover.
alter table ingredients add column if not exists lead_days int not null default 2;
alter table ingredients drop constraint if exists ingredients_lead_days_check;
alter table ingredients add constraint ingredients_lead_days_check check (lead_days between 0 and 60);
alter table restaurants add column if not exists purchase_cover_days int not null default 7;
alter table restaurants drop constraint if exists restaurants_purchase_cover_days_check;
alter table restaurants add constraint restaurants_purchase_cover_days_check
  check (purchase_cover_days between 1 and 60);

-- Something thrown away: an ingredient (spoiled milk) or a dish (an unsold
-- croissant, a latte made wrong, the staff's lunch). Its cost is fixed when it
-- is recorded, so a later price never rewrites what was lost; null when the
-- dish has no recipe. The name is kept for the same reason.
create table if not exists waste_entries (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  ingredient_id uuid references ingredients(id) on delete cascade,
  item_id       uuid references menu_items(id) on delete cascade,
  name          text not null check (char_length(name) <= 160),
  quantity      numeric not null check (quantity > 0 and quantity <= 100000),
  reason        text not null check (reason in ('spoiled', 'unsold', 'mistake', 'staff')),
  note          text check (note is null or char_length(note) <= 140),
  cost          numeric check (cost is null or cost >= 0),
  recorded_by   text not null,
  created_at    timestamptz not null default now(),
  check ((ingredient_id is null) <> (item_id is null))
);
create index if not exists waste_entries_recent_idx on waste_entries(restaurant_id, created_at desc);
alter table waste_entries enable row level security;
revoke all on waste_entries from anon;
revoke all on waste_entries from authenticated;
grant all on waste_entries to service_role;

-- What came in: how much (in the ingredient's own unit) and what it cost.
create table if not exists ingredient_purchases (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  quantity      numeric not null check (quantity > 0 and quantity <= 10000000),
  total         numeric not null check (total >= 0 and total <= 10000000),
  recorded_by   text not null,
  created_at    timestamptz not null default now()
);
create index if not exists ingredient_purchases_recent_idx on ingredient_purchases(restaurant_id, created_at desc);
alter table ingredient_purchases enable row level security;
revoke all on ingredient_purchases from anon;
revoke all on ingredient_purchases from authenticated;
grant all on ingredient_purchases to service_role;

-- What somebody counted on the shelf, and what the books said it should be at
-- that moment. Counted before the expected figure is shown, like the drawer:
-- a count adjusted after seeing the answer is not a count. Null expected on an
-- ingredient's first count — there was nothing to compare with.
create table if not exists ingredient_counts (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  counted       numeric not null check (counted >= 0 and counted <= 10000000),
  expected      numeric,
  counted_by    text not null,
  created_at    timestamptz not null default now()
);
create index if not exists ingredient_counts_latest_idx on ingredient_counts(restaurant_id, ingredient_id, created_at desc);
alter table ingredient_counts enable row level security;
revoke all on ingredient_counts from anon;
revoke all on ingredient_counts from authenticated;
grant all on ingredient_counts to service_role;

-- A waste entry, and — for a dish whose stock is counted — the units it
-- takes off the shelf, in one transaction: a croissant in the bin must not
-- stay on the menu. Under the dish's lock, like an order taking stock, and
-- never below zero; reaching zero takes the dish off the way a sale would.
-- Returns the entry's id, or null when the ingredient or dish is not this
-- restaurant's (or the ingredient is archived).
create or replace function public.record_waste(
  p_restaurant uuid, p_ingredient uuid, p_item uuid, p_quantity numeric,
  p_reason text, p_note text, p_cost numeric, p_actor text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_stock int;
  v_id uuid;
begin
  -- A trusted stock movement: it keeps the dish's count generation.
  perform set_config('tabletap.stock_movement', 'on', true);
  if (p_ingredient is null) = (p_item is null) then return null; end if;
  -- Product locks still precede movement locks, as they do for a sale.
  if p_item is not null then perform 1 from menu_items where id = p_item and restaurant_id = p_restaurant for update; end if;
  perform public.lock_ingredient_movements(p_restaurant);
  if p_ingredient is not null then
    select name into v_name from ingredients
     where id = p_ingredient and restaurant_id = p_restaurant and archived_at is null;
  else
    select name, stock into v_name, v_stock from menu_items
     where id = p_item and restaurant_id = p_restaurant for update;
  end if;
  if v_name is null then return null; end if;
  if v_stock is not null then
    update menu_items
       set stock          = greatest(v_stock - ceil(p_quantity)::int, 0),
           available      = case when v_stock - ceil(p_quantity)::int <= 0 then false else available end,
           stock_auto_off = case when v_stock - ceil(p_quantity)::int <= 0 and available then true else stock_auto_off end
     where id = p_item;
  end if;
  insert into waste_entries (restaurant_id, ingredient_id, item_id, name, quantity, reason, note, cost, recorded_by)
  values (p_restaurant, p_ingredient, p_item, v_name, p_quantity, p_reason, p_note, p_cost, p_actor)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.record_waste(uuid, uuid, uuid, numeric, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.record_waste(uuid, uuid, uuid, numeric, text, text, numeric, text) to service_role;

-- A delivery, and the price it came at: when a pack cost something different
-- this time, that is the ingredient's price now, and the price trigger keeps
-- the change. Returns the purchase's id, or null when the ingredient is not
-- this restaurant's.
create or replace function public.record_purchase(
  p_restaurant uuid, p_ingredient uuid, p_packs numeric, p_total numeric, p_actor text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_ingredient ingredients%rowtype;
  v_pack_price numeric;
  v_id uuid;
begin
  if p_packs <= 0 then return null; end if;
  select * into v_ingredient from ingredients
   where id = p_ingredient and restaurant_id = p_restaurant and archived_at is null for update;
  if v_ingredient.id is null then return null; end if;
  v_pack_price := round(p_total / p_packs, 2);
  if v_pack_price is distinct from v_ingredient.pack_price then
    update ingredients set pack_price = v_pack_price, updated_by = p_actor where id = p_ingredient;
  end if;
  insert into ingredient_purchases (restaurant_id, ingredient_id, quantity, total, recorded_by)
  values (p_restaurant, p_ingredient, p_packs * v_ingredient.pack_size, p_total, p_actor)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.record_purchase(uuid, uuid, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.record_purchase(uuid, uuid, numeric, numeric, text) to service_role;

-- ── The restaurant's own card terminal: what it should deposit ─────────────
-- A café charges cards on its own terminal (Clip, Mercado Pago Point, a
-- bank's) and the money arrives days later, less the terminal's fee. It asked
-- to match each payment to its sale, see the tips apart, and know what should
-- land in the bank and when — while it keeps using the terminal by hand.
--
-- A card payment the till takes can carry the voucher's reference, to find
-- the sale a voucher belongs to. Written by the server after the payment.
alter table payments add column if not exists terminal_ref text;
alter table payments drop constraint if exists payments_terminal_ref_check;
alter table payments add constraint payments_terminal_ref_check
  check (terminal_ref is null or (char_length(terminal_ref) between 1 and 40));

-- When the server recorded the money, as opposed to when it was taken
-- (`created_at`, which a sale the till held offline backdates to the moment it
-- happened). A day reconciled before a late sale arrived reads it from here.
-- Null on rows from before this column, which were recorded when dated; the
-- default is set separately so adding it rewrites no existing row.
alter table payments add column if not exists recorded_at timestamptz;
alter table payments alter column recorded_at set default now();

-- How many business days the terminal's bank takes to deposit a day's sales.
alter table restaurants add column if not exists terminal_settle_days int not null default 1;
alter table restaurants drop constraint if exists restaurants_terminal_settle_days_check;
alter table restaurants add constraint restaurants_terminal_settle_days_check
  check (terminal_settle_days between 0 and 10);

-- A day's terminal sales, marked as deposited: what the bank actually paid,
-- against what was expected at the moment it was marked. One per currency/day; taken
-- back and marked again if it was marked wrong. Server-only.
create table if not exists terminal_deposits (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  sales_day     date not null,
  expected      numeric not null check (expected >= 0 and expected <= 100000000),
  received      numeric not null check (received >= 0 and received <= 100000000),
  note          text check (note is null or char_length(note) <= 140),
  recorded_by   text not null,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, sales_day)
);
-- Currency is part of a deposit's identity. Never relabel an old deposit
-- from today's restaurant setting: a bank receipt must establish its currency.
-- Null preserves older records for that verification, outside currency totals.
alter table terminal_deposits add column if not exists currency text check (currency in ('MXN', 'USD'));
alter table terminal_deposits drop constraint if exists terminal_deposits_restaurant_id_sales_day_key;
create unique index if not exists terminal_deposits_currency_day
  on terminal_deposits (restaurant_id, sales_day, currency) where currency is not null;
-- Older deployed writers can still insert a legacy record during deployment,
-- but cannot mark the same unverified day twice.
create unique index if not exists terminal_deposits_unverified_day
  on terminal_deposits (restaurant_id, sales_day) where currency is null;
alter table terminal_deposits enable row level security;
revoke all on terminal_deposits from anon;
revoke all on terminal_deposits from authenticated;
grant all on terminal_deposits to service_role;

-- ── A till that keeps selling when the connection drops ────────────────────
-- A counter's sales cannot wait for the wifi. With the connection gone the
-- till keeps a cash or own-terminal sale on its device, under the reference
-- it made for it, and sends it when the connection returns — the same
-- reference, so a sale sent twice is rung once. The money was taken when it
-- happened, so the server records it then, as it was taken.
--
-- When it happened, for a sale rung without a connection; null otherwise.
alter table orders add column if not exists offline_at timestamptz;
-- What was collected less what today's menu prices it at, when the menu
-- moved during the outage: the corte follows the drawer, and a manager is
-- shown the difference. Null when nothing could be compared.
alter table orders add column if not exists offline_drift numeric;

-- An offline sale's money, dated when it was taken: the drawer it went into
-- is that shift's, and the corte it belongs to is that day's. It arrives
-- finished — the kitchen worked from the ticket at the time — so it is
-- completed, never a new ticket on the board. Same guard as settle_sale:
-- only an unpaid sale awaiting its payment, once.
create or replace function public.settle_offline_sale(
  p_restaurant uuid, p_order uuid, p_method text, p_actor text, p_at timestamptz
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
begin
  perform public.lock_restaurant_money(p_restaurant);
  if p_method not in ('cash', 'card') then
    raise exception 'settle_offline_sale: unknown method %', p_method;
  end if;
  update orders
     set paid = true, pay_method = p_method, status = 'completed'
   where id = p_order and restaurant_id = p_restaurant and paid = false and status = 'pending_payment'
  returning total into v_total;
  if not found then
    raise exception 'not_owed';
  end if;
  if v_total > 0 then
    insert into payments (restaurant_id, order_id, amount, method, actor_email, created_at)
    values (p_restaurant, p_order, round(v_total, 2), p_method, p_actor, p_at);
  end if;
  return true;
end;
$$;
revoke all on function public.settle_offline_sale(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.settle_offline_sale(uuid, uuid, text, text, timestamptz) to service_role;

-- The stock an offline sale took. It already happened, so it is never
-- refused: a dish whose count is short goes to nought, off the menu the way
-- a sale would take it, and no further. Under each dish's lock, in id order.
create or replace function public.take_stock_floor(p_restaurant uuid, p_demand jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_row record;
begin
  -- A trusted stock movement: it keeps the dish's count generation.
  perform set_config('tabletap.stock_movement', 'on', true);
  for v_row in
    select m.id, m.stock, m.available, (d.qty)::int as want
      from jsonb_to_recordset(p_demand) as d(item_id uuid, qty int)
      join menu_items m on m.id = d.item_id and m.restaurant_id = p_restaurant
     where m.stock is not null
     order by m.id
       for update of m
  loop
    update menu_items
       set stock          = greatest(v_row.stock - v_row.want, 0),
           available      = case when v_row.stock - v_row.want <= 0 then false else available end,
           stock_auto_off = case when v_row.stock - v_row.want <= 0 and v_row.available then true else stock_auto_off end
     where id = v_row.id;
  end loop;
end;
$$;
revoke all on function public.take_stock_floor(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.take_stock_floor(uuid, jsonb) to service_role;

revoke truncate, references, trigger on all tables in schema public from authenticated;

-- When it was cancelled. A sale on the restaurant's own terminal is voided
-- there by a person: the same day, the bank never pays it; a later day, it
-- comes out of a deposit still to come. The deposits are dated by this. Null
-- for orders cancelled before it was kept.
alter table orders add column if not exists cancelled_at timestamptz;

-- The status guard and proven stock handback share one transaction. New orders
-- are returned by the trigger using their exact reservation, regardless of plan.
-- Legacy lines alone cannot prove what was deducted, so they return nothing.
drop function if exists public.cancel_order(uuid, uuid, text, jsonb);
create or replace function public.cancel_order(
  p_restaurant uuid, p_order uuid, p_refund text, p_legacy_demand jsonb,
  p_expected_paid boolean, p_expected_account uuid, p_expected_hold timestamptz, p_expected_checkout uuid
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_order orders%rowtype;
  v_account customer_accounts;
begin
  perform public.lock_restaurant_money(p_restaurant);
  -- Collection holds the account first. Recheck the plan under that lock so
  -- an unpaid cancel cannot silently erase food that was just collected.
  if p_expected_account is not null then
    select * into v_account from customer_accounts
     where id = p_expected_account and restaurant_id = p_restaurant for update;
    if v_account.id is null or v_account.checkout_until is distinct from p_expected_hold
       or v_account.checkout_id is distinct from p_expected_checkout then
      return false;
    end if;
    if not p_expected_paid and v_account.checkout_until > now() then return false; end if;
  end if;
  select * into v_order from orders where id = p_order and restaurant_id = p_restaurant for update;
  if v_order.id is null or v_order.paid is distinct from p_expected_paid
     or v_order.account_id is distinct from p_expected_account then return false; end if;
  update orders set status = 'cancelled', stripe_refund_id = p_refund, cancelled_at = now()
    where id = p_order and restaurant_id = p_restaurant and status in ('received', 'preparing')
    returning * into v_order;
  if not found then return false; end if;
  -- The order trigger returns proven reservations and logs unknown legacy stock.
  return true;
end;
$$;
revoke all on function public.cancel_order(uuid, uuid, text, jsonb, boolean, uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.cancel_order(uuid, uuid, text, jsonb, boolean, uuid, timestamptz, uuid) to service_role;

-- ── Platform fees: one row per charge, the ledger the monthly ceiling reads ──
-- Each plan promises "never more than X" in per-order fees a month. The
-- ceiling used to be summed from orders.platform_fee, which says neither when
-- a charge happened, whether it went through, nor how much of it was given
-- back — so it counted abandoned checkouts, missed a divided bill's fee until
-- every share landed, filed a fee under the month its food was ordered, and
-- lost a fee whose write failed. Here every checkout RESERVES its fee before
-- Stripe is asked, under a lock per restaurant, so two diners at once never
-- both fit under one ceiling; the payment marks it taken; only Stripe's
-- expiry (or a session that was never created) releases it; a refund records
-- the share of the fee that went back. A reservation nobody confirms keeps
-- counting: a little over, never under.
create table if not exists platform_fees (
  id                    uuid primary key default gen_random_uuid(),
  restaurant_id         uuid not null references restaurants(id) on delete cascade,
  -- The UTC month the fee was reserved in: the month whose ceiling it uses.
  period                date not null,
  cents                 integer not null check (cents > 0),
  refunded_cents        integer not null default 0 check (refunded_cents >= 0 and refunded_cents <= cents),
  -- Stripe refund ids already counted, so a retried refund is counted once.
  refund_ids            text[] not null default '{}',
  status                text not null default 'open' check (status in ('open', 'taken', 'released')),
  source                text not null,
  -- One fee per thing that pays one fee: a divided bill pays it once.
  ref                   text,
  stripe_payment_intent text,
  -- The Stripe session the fee rides on, so a reopened share can retire it.
  stripe_session_id     text,
  charge_cents          integer check (charge_cents is null or charge_cents > 0),
  created_at            timestamptz not null default now(),
  settled_at            timestamptz
);
create index if not exists platform_fees_period_idx on platform_fees(restaurant_id, period);
create index if not exists platform_fees_intent_idx on platform_fees(restaurant_id, stripe_payment_intent)
  where stripe_payment_intent is not null;
create unique index if not exists platform_fees_ref_idx on platform_fees(restaurant_id, ref)
  where ref is not null and status <> 'released';
alter table platform_fees add column if not exists stripe_session_id text;
alter table platform_fees drop constraint if exists platform_fees_source_check;
alter table platform_fees add constraint platform_fees_source_check
  check (source in ('order', 'bill', 'split', 'account', 'session', 'backfill'));
alter table platform_fees enable row level security;
revoke all on platform_fees from anon;
revoke all on platform_fees from authenticated;
grant all on platform_fees to service_role;

-- Reserve this checkout's fee under the month's ceiling. `p_cents` is the
-- per-order fee; `p_cap_cents` the month's ceiling, null for none. Returns
-- no row when nothing is to be charged: the ceiling is reached, or `p_ref`
-- already carries a fee that is not released.
create or replace function public.reserve_platform_fee(
  p_restaurant uuid, p_cents integer, p_cap_cents integer, p_source text, p_ref text
) returns table (fee_id uuid, fee_cents integer)
language plpgsql security definer set search_path = public as $$
declare
  v_period date := date_trunc('month', now() at time zone 'utc')::date;
  v_used integer;
  v_cents integer;
begin
  if p_cents is null or p_cents <= 0 then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('platform_fee:' || p_restaurant::text, 0));
  if p_ref is not null and exists (
    select 1 from platform_fees f
     where f.restaurant_id = p_restaurant and f.ref = p_ref and f.status <> 'released'
  ) then
    return;
  end if;
  if p_cap_cents is null then
    v_cents := p_cents;
  else
    select coalesce(sum(f.cents - f.refunded_cents), 0) into v_used
      from platform_fees f
     where f.restaurant_id = p_restaurant and f.period = v_period and f.status <> 'released';
    v_cents := greatest(0, least(p_cents, p_cap_cents - v_used));
  end if;
  if v_cents <= 0 then return; end if;
  return query
    insert into platform_fees (restaurant_id, period, cents, source, ref)
    values (p_restaurant, v_period, v_cents, p_source, p_ref)
    returning platform_fees.id, platform_fees.cents;
end;
$$;
revoke all on function public.reserve_platform_fee(uuid, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.reserve_platform_fee(uuid, integer, integer, text, text) to service_role;

-- The money landed: the fee is ours. Whatever it was before — a late
-- completion after an expiry still means Stripe took the fee.
create or replace function public.take_platform_fee(
  p_fee uuid, p_intent text, p_charge_cents integer
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  update platform_fees
     set status = 'taken',
         -- Revived from released: a newer reservation may hold its ref now.
         ref = case when status = 'released' then null else ref end,
         settled_at = coalesce(settled_at, now()),
         stripe_payment_intent = coalesce(stripe_payment_intent, p_intent),
         charge_cents = coalesce(charge_cents, nullif(p_charge_cents, 0))
   where id = p_fee;
  return found;
end;
$$;
revoke all on function public.take_platform_fee(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.take_platform_fee(uuid, text, integer) to service_role;

-- Nobody paid it — Stripe's expiry, or a session that was never created.
-- Only an open reservation is released; a taken fee never is.
create or replace function public.release_platform_fee(p_fee uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update platform_fees set status = 'released' where id = p_fee and status = 'open';
  return found;
end;
$$;
revoke all on function public.release_platform_fee(uuid) from public, anon, authenticated;
grant execute on function public.release_platform_fee(uuid) to service_role;

-- A fee Stripe took on a session with no reservation to take — opened before
-- the ledger existed, or whose row is gone. Recorded from the session, taken,
-- once per `p_ref` ('order:<id>' for a diner's own order, the same key the
-- backfill writes; 'session:<id>' otherwise).
create or replace function public.record_session_fee(
  p_restaurant uuid, p_ref text, p_cents integer, p_intent text, p_charge_cents integer
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_cents is null or p_cents <= 0 or p_ref is null then return false; end if;
  insert into platform_fees (restaurant_id, period, cents, status, source, ref, stripe_payment_intent, charge_cents, settled_at)
  values (p_restaurant, date_trunc('month', now() at time zone 'utc')::date, p_cents, 'taken', 'session', p_ref,
          p_intent, nullif(p_charge_cents, 0), now())
  on conflict (restaurant_id, ref) where ref is not null and status <> 'released' do nothing;
  return found;
end;
$$;
revoke all on function public.record_session_fee(uuid, text, integer, text, integer) from public, anon, authenticated;
grant execute on function public.record_session_fee(uuid, text, integer, text, integer) to service_role;

-- A refund on a charge that carried our fee: Stripe returns the fee in
-- proportion to what was refunded. Rounded down, so the fee we kept is never
-- counted short; once per Stripe refund id, so a retried refund counts once.
create or replace function public.refund_platform_fee(
  p_restaurant uuid, p_intent text, p_refund_cents integer, p_refund_id text
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  update platform_fees
     set refunded_cents = least(cents, refunded_cents + floor(cents::numeric * p_refund_cents / charge_cents)::integer),
         refund_ids = refund_ids || p_refund_id
   where restaurant_id = p_restaurant and stripe_payment_intent = p_intent
     and status = 'taken' and charge_cents > 0 and p_refund_cents > 0
     and not (p_refund_id = any(refund_ids));
  return found;
end;
$$;
revoke all on function public.refund_platform_fee(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.refund_platform_fee(uuid, text, integer, text) to service_role;

-- Fees from before the ledger, from `orders.platform_fee` — which nothing
-- writes any more, so this set is frozen and the insert is safe to run again:
-- each order once ('order:<id>', the key a late-settling session records
-- under too). The last 31 days, the costs screen's window; each in the month
-- its order was placed. A checkout still waiting to be paid is left to its
-- webhook, which records it when the money lands.
insert into platform_fees (restaurant_id, period, cents, status, source, ref, created_at, settled_at)
select o.restaurant_id, date_trunc('month', o.created_at at time zone 'utc')::date,
       round(o.platform_fee * 100)::integer, 'taken', 'backfill', 'order:' || o.id, o.created_at, o.created_at
  from orders o
 where o.platform_fee > 0
   and o.status <> 'pending_payment'
   and o.created_at >= now() - interval '31 days'
on conflict (restaurant_id, ref) where ref is not null and status <> 'released' do nothing;

-- Stripe writes outlive a database transaction. Hold one durable claim across
-- checkout and deletion so two servers cannot create two billing contracts.
-- After 15 minutes recovery must first reconcile Stripe, then replace the token.
-- No FK: a deletion retry must retain billing IDs after its restaurant is gone.
create table if not exists restaurant_billing_operations (
  restaurant_id uuid primary key,
  token uuid,
  started_at timestamptz,
  state jsonb not null default '{}'::jsonb
);
alter table restaurant_billing_operations enable row level security;
revoke all on restaurant_billing_operations from anon, authenticated, public;
grant all on restaurant_billing_operations to service_role;

create or replace function public.claim_restaurant_billing(p_restaurant uuid, p_token uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  -- A completed deletion can be retried even after its restaurant is gone.
  update restaurant_billing_operations set token = p_token, started_at = now()
    where restaurant_id = p_restaurant and token is null;
  if found then return true; end if;
  insert into restaurant_billing_operations (restaurant_id, token, started_at)
    select id, p_token, now() from restaurants where id = p_restaurant
    on conflict (restaurant_id) do nothing;
  return found;
end;
$$;
revoke all on function public.claim_restaurant_billing(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_restaurant_billing(uuid, uuid) to service_role;

create or replace function public.record_restaurant_billing(p_restaurant uuid, p_token uuid, p_state jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_state jsonb;
  v_key text;
begin
  select state into v_state from restaurant_billing_operations
    where restaurant_id = p_restaurant and token = p_token
      and started_at > now() - interval '15 minutes' for update;
  if not found then return false; end if;
  -- Keep all observed IDs, including canceled contracts, for deletion retries.
  foreach v_key in array array['customers', 'sessions', 'subscriptions'] loop
    p_state := jsonb_set(p_state, array[v_key], (
      select coalesce(jsonb_agg(distinct value), '[]'::jsonb)
      from jsonb_array_elements(coalesce(v_state->v_key, '[]'::jsonb) || coalesce(p_state->v_key, '[]'::jsonb))
    ));
  end loop;
  update restaurant_billing_operations set state = v_state || p_state, started_at = now()
    where restaurant_id = p_restaurant and token = p_token;
  return found;
end;
$$;
revoke all on function public.record_restaurant_billing(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_restaurant_billing(uuid, uuid, jsonb) to service_role;

-- Only the service can supply the snapshot it just read from Stripe. Compare
-- both token and expiry so a heartbeat or a competing takeover wins safely.
create or replace function public.takeover_restaurant_billing(
  p_restaurant uuid, p_token uuid, p_previous uuid, p_started_at timestamptz, p_state jsonb
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  update restaurant_billing_operations set token = p_token, started_at = now()
    where restaurant_id = p_restaurant and token = p_previous and started_at = p_started_at
      and started_at <= now() - interval '15 minutes';
  if not found then return false; end if;
  perform public.record_restaurant_billing(p_restaurant, p_token, p_state);
  return true;
end;
$$;
revoke all on function public.takeover_restaurant_billing(uuid, uuid, uuid, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.takeover_restaurant_billing(uuid, uuid, uuid, timestamptz, jsonb) to service_role;

create or replace function public.release_restaurant_billing(p_restaurant uuid, p_token uuid)
returns void language sql security definer set search_path = public as $$
  update restaurant_billing_operations set token = null, started_at = null
    where restaurant_id = p_restaurant and token = p_token;
$$;
revoke all on function public.release_restaurant_billing(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_restaurant_billing(uuid, uuid) to service_role;

revoke truncate, references, trigger on all tables in schema public from authenticated;

-- A retry and a new sale share the same lock, including a foreign reference.
-- Never reveal a different restaurant's ticket or acknowledge an unpaid shell.
create or replace function public.pos_ticket(p_restaurant uuid, p_ref uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order orders%rowtype;
  v_name text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_ref::text, 1));
  select * into v_order from orders
   where restaurant_id = p_restaurant and pos_ref = p_ref for update;
  if not found then
    if exists (select 1 from orders where pos_ref = p_ref or id = p_ref) then
      return jsonb_build_object('outcome', 'conflict');
    end if;
    return null;
  end if;
  if v_order.status = 'pending_payment' or (not v_order.paid
      and (v_order.account_id is null or v_order.charged_at is null)) then
    return jsonb_build_object('outcome', 'unsettled');
  end if;
  if v_order.account_id is not null then
    select name into v_name from customer_accounts
     where id = v_order.account_id and restaurant_id = p_restaurant;
  end if;
  return jsonb_build_object('outcome', 'settled', 'settled', true, 'repeat', true,
    'orderId', v_order.id, 'total', v_order.total, 'currency', v_order.currency, 'method', v_order.pay_method, 'handedOver', v_order.status = 'completed')
    || case when v_order.account_id is null then '{}'::jsonb
       else jsonb_build_object('onAccount', jsonb_build_object('name', v_name)) end;
end;
$$;
revoke all on function public.pos_ticket(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pos_ticket(uuid, uuid) to service_role;

-- Keep the writable fields explicit: the caller cannot smuggle paid or tenant fields.
create or replace function public.pos_insert_order(
  p_restaurant uuid, p_ref uuid, p_order jsonb, p_status text, p_at timestamptz, p_reservation uuid
) returns void language plpgsql security definer set search_path = public as $$
begin
  -- A queued receipt can enter the ledger only through its approved recovery.
  if exists(select 1 from offline_sale_queue where pos_ref = p_ref)
    and current_setting('tabletap.offline_queue_writer',true) is distinct from p_ref::text then
    raise exception 'manager approval required';
  end if;
  insert into orders (id, restaurant_id, pos_ref, status, paid, stock_managed, stock_reservation_id,
    subtotal, service_fee, tip, discount, total, tax_pct, platform_fee, promo_detail,
    currency, items, note, customer_name, created_at, offline_at, offline_drift)
  values (p_ref, p_restaurant, p_ref, p_status, false, p_at is null, p_reservation,
    (p_order->>'subtotal')::numeric, (p_order->>'service_fee')::numeric,
    (p_order->>'tip')::numeric, (p_order->>'discount')::numeric, (p_order->>'total')::numeric,
    (p_order->>'tax_pct')::numeric, 0, p_order->'promo_detail',
    p_order->>'currency', p_order->'items', p_order->>'note', p_order->>'customer_name',
    coalesce(p_at, now()), p_at, (p_order->>'offline_drift')::numeric);
end;
$$;
revoke all on function public.pos_insert_order(uuid, uuid, jsonb, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.pos_insert_order(uuid, uuid, jsonb, text, timestamptz, uuid) to service_role;

-- Insert, stock, ledger and voucher commit together. A lost response needs only a retry.
create or replace function public.ring_pos_sale(
  p_restaurant uuid, p_ref uuid, p_order jsonb, p_method text, p_actor text,
  p_status text, p_at timestamptz, p_terminal text, p_demand jsonb,
  p_inventory boolean, p_threshold int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ticket jsonb;
  v_stock jsonb := '{"ok":true,"low":[]}'::jsonb;
  v_reservation uuid;
begin
  perform public.lock_restaurant_money(p_restaurant);
  if p_method not in ('cash', 'card') or p_status not in ('received', 'completed') then
    raise exception 'Invalid till sale';
  end if;
  v_ticket := public.pos_ticket(p_restaurant, p_ref);
  if v_ticket is not null then return v_ticket; end if;
  if p_at is not null then
    -- It already happened, so the count floors at zero rather than refusing.
    -- In the same transaction as the money: a sale recorded without its stock
    -- was acknowledged, and nothing ever moved the count again. The floor
    -- skips dishes that are gone and cannot run short, so what can fail here
    -- is a lock that timed out, which the device's next send retries whole.
    perform public.take_stock_floor(p_restaurant, p_demand);
  elsif p_inventory then
    v_reservation := p_ref;
    v_stock := public.reserve_stock(p_restaurant, p_demand, p_threshold, v_reservation);
    if not (v_stock->>'ok')::boolean then
      return v_stock || jsonb_build_object('outcome', 'stock');
    end if;
  end if;
  perform public.pos_insert_order(p_restaurant, p_ref, p_order, 'pending_payment', p_at, v_reservation);
  if p_at is not null then
    perform public.settle_offline_sale(p_restaurant, p_ref, p_method, p_actor, p_at);
  else
    perform public.settle_sale(p_restaurant, p_ref, p_method, p_actor, p_status);
  end if;
  if p_method = 'card' and p_terminal is not null then
    update payments set terminal_ref = p_terminal
     where restaurant_id = p_restaurant and order_id = p_ref and method = 'card';
  end if;
  return jsonb_build_object('outcome', 'settled', 'settled', true, 'orderId', p_ref,
    'total', (p_order->>'total')::numeric, 'low', v_stock->'low',
    'handedOver', p_at is not null or p_status = 'completed');
end;
$$;
revoke all on function public.ring_pos_sale(uuid, uuid, jsonb, text, text, text, timestamptz, text, jsonb, boolean, int) from public, anon, authenticated;
grant execute on function public.ring_pos_sale(uuid, uuid, jsonb, text, text, text, timestamptz, text, jsonb, boolean, int) to service_role;

-- A refused account charge rolls back its stock and unpublished ticket together.
create or replace function public.ring_pos_account(
  p_restaurant uuid, p_ref uuid, p_order jsonb, p_account uuid, p_actor text,
  p_status text, p_demand jsonb, p_inventory boolean, p_threshold int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ticket jsonb;
  v_charge jsonb;
  v_stock jsonb := '{"ok":true,"low":[]}'::jsonb;
  v_reservation uuid;
  v_name text;
begin
  perform public.lock_restaurant_money(p_restaurant);
  if p_status not in ('received', 'completed') then raise exception 'Invalid till status'; end if;
  v_ticket := public.pos_ticket(p_restaurant, p_ref);
  if v_ticket is not null then return v_ticket; end if;
  -- Lock the account before stock, as every credit decision must see its latest debt.
  select name into v_name from customer_accounts
   where id = p_account and restaurant_id = p_restaurant for update;
  if not found then return jsonb_build_object('outcome', 'closed'); end if;
  begin
    if p_inventory then
      v_reservation := p_ref;
      v_stock := public.reserve_stock(p_restaurant, p_demand, p_threshold, v_reservation);
      if not (v_stock->>'ok')::boolean then
        return v_stock || jsonb_build_object('outcome', 'stock');
      end if;
    end if;
    perform public.pos_insert_order(p_restaurant, p_ref, p_order, p_status, null, v_reservation);
    v_charge := public.account_charge(p_restaurant, p_account, array[p_ref], (p_order->>'total')::numeric, p_actor);
    if v_charge->>'outcome' <> 'charged' then
      raise exception using errcode = 'PT001', message = 'Account refused the sale';
    end if;
  exception when sqlstate 'PT001' then
    return v_charge;
  end;
  return jsonb_build_object('outcome', 'settled', 'settled', true, 'orderId', p_ref,
    'total', (p_order->>'total')::numeric, 'low', v_stock->'low', 'handedOver', p_status = 'completed',
    'onAccount', jsonb_build_object('name', v_name, 'owed', v_charge->'owed'));
end;
$$;
revoke all on function public.ring_pos_account(uuid, uuid, jsonb, uuid, text, text, jsonb, boolean, int) from public, anon, authenticated;
grant execute on function public.ring_pos_account(uuid, uuid, jsonb, uuid, text, text, jsonb, boolean, int) to service_role;

-- A manager approves the shown debt, not whatever the ids happen to owe later.
create or replace function public.approve_write_off_request(
  p_request uuid, p_restaurant uuid, p_actor text, p_amount numeric, p_note text
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_request write_off_requests%rowtype;
  v_count int;
  v_total numeric;
begin
  perform public.lock_restaurant_money(p_restaurant);
  select * into v_request from write_off_requests
   where id = p_request and restaurant_id = p_restaurant for update;
  if not found or v_request.status <> 'pending' then return 'gone'; end if;
  if p_amount is null or p_amount <= 0 or v_request.amount <> p_amount then return 'changed'; end if;
  perform 1 from orders where id = any(v_request.order_ids) and restaurant_id = p_restaurant
   order by id for update;
  select count(*), coalesce(sum(total), 0) into v_count, v_total from orders
   where id = any(v_request.order_ids) and restaurant_id = p_restaurant
     and paid = false and written_off = false and status not in ('cancelled', 'pending_payment')
     -- An order moved onto a customer account is the account's debt now.
     and account_id is null;
  if v_count <> cardinality(v_request.order_ids) or round(v_total, 2) <> p_amount then return 'changed'; end if;

  update orders set written_off = true, write_off_reason = v_request.reason,
    write_off_note = v_request.note, written_off_by = p_actor, written_off_at = now(), status = 'completed'
   where id = any(v_request.order_ids) and restaurant_id = p_restaurant
     and paid = false and written_off = false and status not in ('cancelled', 'pending_payment')
     and account_id is null;
  update write_off_requests set status = 'approved', decided_by = p_actor, decided_at = now(), decided_note = p_note
   where id = p_request and restaurant_id = p_restaurant and status = 'pending';
  return 'approved';
end; $$;
revoke all on function public.approve_write_off_request(uuid, uuid, text, numeric, text) from public, anon, authenticated;
grant execute on function public.approve_write_off_request(uuid, uuid, text, numeric, text) to service_role;

-- The coupon, its use and every order change commit with the one decision.
create or replace function public.approve_discount_request(
  p_request uuid, p_restaurant uuid, p_actor text, p_amount numeric
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_request discount_requests%rowtype;
  v_coupon coupons%rowtype;
  v_count int;
  v_total numeric;
  v_amount numeric;
begin
  perform public.lock_restaurant_money(p_restaurant);
  select * into v_request from discount_requests
   where id = p_request and restaurant_id = p_restaurant for update;
  if not found or v_request.status <> 'pending' then return 'gone'; end if;
  if p_amount is null or p_amount <= 0 or v_request.amount <> p_amount then return 'changed'; end if;
  perform 1 from orders where id = any(v_request.order_ids) and restaurant_id = p_restaurant
   order by id for update;
  select count(*), coalesce(sum(total), 0) into v_count, v_total from orders
   where id = any(v_request.order_ids) and restaurant_id = p_restaurant
     and paid = false and written_off = false and status not in ('cancelled', 'pending_payment')
     and coupon_code is null and account_id is null;
  if v_count <> cardinality(v_request.order_ids) or v_total <= 0 then return 'changed'; end if;
  select * into v_coupon from coupons
   where restaurant_id = p_restaurant and upper(code) = upper(v_request.code) for update;
  if not found or not v_coupon.active
     or v_coupon.starts_at > now() or v_coupon.ends_at <= now()
     or v_total < v_coupon.min_subtotal
     or v_coupon.uses_count >= v_coupon.max_uses then return 'changed'; end if;
  v_amount := greatest(0, least(v_total, round(case when v_coupon.kind = 'percent'
    then v_total * v_coupon.value / 100 else v_coupon.value end, 2)));
  if v_amount <> p_amount then return 'changed'; end if;
  if redeem_coupon(v_coupon.id) is null then return 'changed'; end if;

  -- Keep the rounding remainder on the largest order, as spreadDiscount does.
  with shares as (
    select id, total, round(p_amount * total / v_total, 2) amount,
      row_number() over (order by total desc, id) position
    from orders where id = any(v_request.order_ids) and restaurant_id = p_restaurant
     and account_id is null
  ), amounts as (
    select id, greatest(0, least(total, amount + case when position = 1
      then p_amount - sum(amount) over () else 0 end)) amount from shares
  )
  update orders o set coupon_code = v_coupon.code,
    discount = round(coalesce(o.discount, 0) + a.amount, 2), total = round(o.total - a.amount, 2)
    from amounts a where o.id = a.id and o.restaurant_id = p_restaurant;
  insert into coupon_redemptions (restaurant_id, coupon_id, order_id, code, amount, confirmed_at)
  values (p_restaurant, v_coupon.id, v_request.order_ids[1], v_coupon.code, p_amount, now());
  update discount_requests set status = 'approved', decided_by = p_actor, decided_at = now()
   where id = p_request and restaurant_id = p_restaurant and status = 'pending';
  return 'approved';
end; $$;
revoke all on function public.approve_discount_request(uuid, uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.approve_discount_request(uuid, uuid, text, numeric) to service_role;

-- Refunded food cannot return to the pass after its stock has been returned.
create or replace function public.keep_order_terminal()
returns trigger language plpgsql set search_path = public as $$
begin
  if (old.status = 'cancelled' or old.written_off)
     and new.status is distinct from old.status then
    raise exception 'A cancelled or written-off order cannot change status';
  end if;
  return new;
end; $$;
drop trigger if exists orders_keep_terminal on orders;
create trigger orders_keep_terminal before update of status on orders
  for each row execute function public.keep_order_terminal();
revoke all on function public.keep_order_terminal() from public, anon, authenticated;

-- The plan cards promise no reporting retention window. History stays readable
-- on every tier; remove the unused limits instead of hiding existing records.
alter table plan_limits drop column if exists analytics_days;
alter table plan_limits drop column if exists log_days;

-- Every price ever issued keeps its tier, including older founding prices.
-- Only the server registers prices; metadata on a subscription cannot grant a tier.
create table if not exists restaurant_subscription_prices (
  price_id text primary key,
  plan text not null references plan_limits(plan)
);
alter table restaurant_subscription_prices enable row level security;
revoke all on restaurant_subscription_prices from anon;
revoke all on restaurant_subscription_prices from public, authenticated;
grant select, insert on restaurant_subscription_prices to service_role;
insert into restaurant_subscription_prices (price_id, plan)
  select stripe_price_id, plan from plan_limits where stripe_price_id is not null
  on conflict (price_id) do nothing;

revoke truncate, references, trigger on all tables in schema public from authenticated;

-- ── Payment provenance: receipts, coverage and return obligations ───────────
-- Amounts remain inclusive of tips. Existing receipts are never recreated.
alter table payments add column if not exists allocation_origin text not null default 'legacy';
alter table payments add column if not exists allocation_version int not null default 0;
alter table payments add column if not exists allocation_quality text not null default 'unresolved';
alter table payments add column if not exists allocation_reason text;
alter table payments add column if not exists allocation_scope uuid[] not null default '{}';
alter table payments add column if not exists unallocated_amount numeric not null default 0;
alter table payments add column if not exists unallocated_tip numeric not null default 0;
alter table payments add column if not exists currency text;
alter table payments add column if not exists stripe_account_id text;
create unique index if not exists payments_tenant_identity on payments(restaurant_id, id);
create unique index if not exists orders_tenant_identity on orders(restaurant_id, id);

alter table payments add column if not exists breakdown_unknown boolean not null default false;
create table if not exists payment_allocations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  payment_id uuid not null,
  order_id uuid not null,
  amount numeric not null check (amount > 0 and amount = round(amount, 2)),
  tip numeric not null check (tip >= 0 and tip <= amount and tip = round(tip, 2)),
  provenance text not null check (provenance in ('exact', 'estimated')),
  created_at timestamptz not null default now(),
  unique (payment_id, order_id),
  unique (restaurant_id, id),
  foreign key (restaurant_id, payment_id) references payments(restaurant_id, id) on delete cascade,
  foreign key (restaurant_id, order_id) references orders(restaurant_id, id) on delete cascade
);
create index if not exists allocations_order_idx on payment_allocations(restaurant_id, order_id);

create table if not exists order_adjustments (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  order_id uuid not null,
  foreign key (restaurant_id, order_id) references orders(restaurant_id, id) on delete cascade,
  kind text not null check (kind = 'cancel'),
  previous_total numeric not null,
  previous_tip numeric not null,
  actor text not null,
  created_at timestamptz not null default now(),
  unique(order_id, kind),
  unique(restaurant_id, id)
);
create table if not exists refund_operations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  adjustment_id uuid not null,
  source text not null check (source in ('stripe', 'cash', 'terminal', 'review')),
  amount numeric not null check (amount > 0 and amount = round(amount, 2)),
  tip numeric not null check (tip >= 0 and tip <= amount and tip = round(tip, 2)),
  currency text not null,
  stripe_account_id text,
  stripe_payment_intent text,
  original_collector text,
  payout_actor text,
  confirmed_by text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'succeeded', 'failed', 'review')),
  stripe_refund_id text,
  provider_status text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(restaurant_id, id),
  foreign key (restaurant_id, adjustment_id) references order_adjustments(restaurant_id, id) on delete cascade
);
alter table refund_operations add column if not exists historical_review boolean not null default false;
create unique index if not exists user_logs_tenant_identity on user_logs(restaurant_id, id);
alter table refund_operations add column if not exists historical_log_id uuid;
alter table refund_operations drop constraint if exists refund_operations_historical_log_id_fkey;
alter table refund_operations add constraint refund_operations_historical_log_id_fkey
  foreign key (restaurant_id, historical_log_id) references user_logs(restaurant_id, id);
alter table refund_operations add column if not exists fee_reconciled_at timestamptz;
-- Unknown is not zero: completion must protect a fee before Stripe can be read.
alter table refund_operations add column if not exists fee_verification_pending boolean not null default true;
alter table refund_operations add column if not exists fee_target_cents int check (fee_target_cents >= 0);
create unique index if not exists refund_historical_log on refund_operations(historical_log_id) where historical_log_id is not null;
create index if not exists refunds_tenant_status on refund_operations(restaurant_id, status, created_at);
create table if not exists refund_allocations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  operation_id uuid not null,
  allocation_id uuid not null,
  foreign key (restaurant_id, operation_id) references refund_operations(restaurant_id, id) on delete cascade,
  foreign key (restaurant_id, allocation_id) references payment_allocations(restaurant_id, id) on delete cascade,
  amount numeric not null check (amount > 0 and amount = round(amount, 2)),
  tip numeric not null check (tip >= 0 and tip <= amount and tip = round(tip, 2)),
  unique(operation_id, allocation_id)
);
create index if not exists returns_allocation_idx on refund_allocations(allocation_id);
create table if not exists refund_attempts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  operation_id uuid not null,
  attempt_no int not null default 1,
  foreign key (restaurant_id, operation_id) references refund_operations(restaurant_id, id) on delete cascade,
  idempotency_key text not null unique,
  amount numeric not null,
  stripe_account_id text not null,
  stripe_payment_intent text not null,
  stripe_refund_id text,
  provider_status text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table refund_attempts add column if not exists attempt_no int not null default 1;
alter table refund_attempts drop constraint if exists refund_attempts_operation_id_key;
create unique index if not exists refund_attempts_number on refund_attempts(operation_id, attempt_no);

alter table refund_operations drop constraint if exists refund_operations_tip_check;
alter table refund_operations add constraint refund_operations_tip_check check (tip >= 0 and tip <= amount and tip = round(tip, 2));
alter table refund_allocations drop constraint if exists refund_allocations_tip_check;
alter table refund_allocations add constraint refund_allocations_tip_check check (tip >= 0 and tip <= amount and tip = round(tip, 2));
alter table payments drop constraint if exists payments_allocation_metadata;
alter table payments add constraint payments_allocation_metadata check (
  allocation_version in (0, 1) and allocation_quality in ('exact', 'estimated', 'unresolved') and allocation_origin in ('legacy', 'live')
  and unallocated_amount >= 0 and unallocated_amount <= amount and unallocated_tip >= 0 and unallocated_tip <= tip
  and unallocated_tip <= unallocated_amount and unallocated_amount - unallocated_tip <= amount - tip);

create or replace function public.lock_restaurant_money(p_restaurant uuid)
returns void language sql security definer set search_path = public as $$
  select pg_advisory_xact_lock(hashtextextended(p_restaurant::text, 707));
$$;
revoke all on function public.lock_restaurant_money(uuid) from public, anon, authenticated;
grant execute on function public.lock_restaurant_money(uuid) to service_role;

-- A snapshot, before the receipt is written: later dishes never join its scope.
create or replace function public.snapshot_payment_scope()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('tabletap.allocation_writer', true) is distinct from 'v1' then
    select currency, stripe_account_id into new.currency, new.stripe_account_id from restaurants where id = new.restaurant_id;
    if new.order_id is not null then
      new.allocation_scope := array[new.order_id];
      select currency into new.currency from orders where id = new.order_id and restaurant_id = new.restaurant_id;
    else
      select coalesce(array_agg(id order by created_at, id), '{}') into new.allocation_scope from orders
        where restaurant_id = new.restaurant_id
          and ((new.account_id is not null and account_id = new.account_id)
            or (new.account_id is null and session_id = new.session_id and account_id is null))
          and (not paid or xmin::text = (txid_current() % 4294967296)::text)
          and not written_off and status not in ('cancelled', 'pending_payment');
    end if;
    new.allocation_origin := 'legacy';
    new.allocation_version := 0;
    return new;
  end if;
  if new.tip < 0 or new.tip > new.amount or new.tip <> round(new.tip, 2) or new.amount <> round(new.amount, 2) then
    raise exception 'invalid receipt precision';
  end if;
  select r.currency, r.stripe_account_id into new.currency, new.stripe_account_id
    from restaurants r where r.id = new.restaurant_id;
  if new.order_id is not null then
    if not exists (select 1 from orders where id = new.order_id and restaurant_id = new.restaurant_id) then
      raise exception 'receipt belongs to another restaurant';
    end if;
    new.allocation_scope := array[new.order_id];
    select currency into new.currency from orders where id = new.order_id;
  elsif nullif(current_setting('tabletap.allocation_scope', true), '') is not null then
    new.allocation_scope := array(select jsonb_array_elements_text(current_setting('tabletap.allocation_scope')::jsonb)::uuid);
  else
    select coalesce(array_agg(o.id order by o.created_at, o.id), '{}') into new.allocation_scope
      from orders o where o.restaurant_id = new.restaurant_id
       and ((new.account_id is not null and o.account_id = new.account_id)
         or (new.account_id is null and new.session_id is not null and o.session_id = new.session_id and o.account_id is null))
       and (not o.paid or o.xmin::text = (txid_current() % 4294967296)::text)
       and not o.written_off and o.status not in ('cancelled', 'pending_payment');
  end if;
  if new.order_id is null and new.session_id is not null then
    new.allocation_scope := array(select id from orders where id = any(new.allocation_scope) and session_id = new.session_id and account_id is null);
  end if;
  if exists (select 1 from unnest(new.allocation_scope) x where not exists
    (select 1 from orders o where o.id = x and o.restaurant_id = new.restaurant_id)) then
    raise exception 'allocation scope crosses restaurants';
  end if;
  if new.account_id is not null and exists(select 1 from orders where id = any(new.allocation_scope)
    and account_id is distinct from new.account_id) then raise exception 'receipt scope has another account'; end if;
  -- Cash and the restaurant's terminal repay the saved debt, not today's menu.
  if new.stripe_payment_intent is null and cardinality(new.allocation_scope) > 0 then
    select min(currency) into new.currency from orders where id = any(new.allocation_scope);
  end if;
  -- Pooled card receipts used today's menu currency. A diner pays the frozen
  -- checkout currency, including a split/account opened after a menu change.
  if new.method = 'card' and new.stripe_payment_intent is not null then
    if exists (select 1 from diner_checkouts c where c.stripe_payment_intent = new.stripe_payment_intent
      and c.restaurant_id = new.restaurant_id) then
      select c.currency, c.stripe_account_id into new.currency, new.stripe_account_id
        from diner_checkouts c where c.stripe_payment_intent = new.stripe_payment_intent
          and c.restaurant_id = new.restaurant_id;
      if exists (select 1 from unnest(new.allocation_scope) x where not exists
        (select 1 from diner_checkouts c where c.stripe_payment_intent = new.stripe_payment_intent
          and c.restaurant_id = new.restaurant_id and x = any(c.order_ids))) then
        raise exception 'receipt scope differs from checkout';
      end if;
    end if;
  end if;
  if exists(select 1 from orders where id = any(new.allocation_scope) and currency <> new.currency) then
    raise exception 'receipt scope has another currency';
  end if;
  new.unallocated_amount := new.amount;
  new.unallocated_tip := new.tip;
  new.allocation_origin := case when current_setting('tabletap.allocation_origin', true) = 'fixture_history' then 'legacy' else 'live' end;
  new.allocation_version := 1;
  new.allocation_quality := case when new.order_id is not null
    or current_setting('tabletap.allocation_writer', true) = 'v1' then 'exact' else 'unresolved' end;
  return new;
end;
$$;
revoke all on function public.snapshot_payment_scope() from public, anon, authenticated;
grant execute on function public.snapshot_payment_scope() to service_role;
drop trigger if exists snapshot_payment_scope on payments;
create trigger snapshot_payment_scope before insert on payments for each row execute function public.snapshot_payment_scope();

-- Principal uses largest-remainder cents; existing receipt tip attribution is
-- preserved during the compatible rollout. A new receipt is not a new tip.
create or replace function public.allocate_receipt(p_payment uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p payments;
  v_principal bigint;
  v_tip bigint;
  v_total bigint;
begin
  select * into p from payments where id = p_payment;
  if p.id is null or p.allocation_quality <> 'exact' then return; end if;
  perform 1 from orders where id = any(p.allocation_scope) order by id for update;
  select * into p from payments where id = p_payment for update;
  if exists (select 1 from payment_allocations where payment_id = p.id) then return; end if;
  perform set_config('tabletap.allocating', p.id::text, true);
  -- Older single-order writers omitted receipt tip metadata. For NEW receipts
  -- only, the explicitly named order proves both the amount and its tip.
  if p.order_id is not null and p.tip = 0 and exists
    (select 1 from orders where id = p.order_id and abs(total - p.amount) < 0.005 and tip > 0) then
    update payments set tip = (select least(tip, p.amount) from orders where id = p.order_id),
      unallocated_tip = (select least(tip, p.amount) from orders where id = p.order_id) where id = p.id returning * into p;
  end if;
  v_principal := round((p.amount - p.tip) * 100);
  v_tip := round(p.tip * 100);
  with needs as (
    select o.id, o.created_at,
      greatest(round((o.total - o.tip - coalesce(a.principal, 0)) * 100), 0)::bigint as principal,
      greatest(round((o.tip - coalesce(a.tip, 0)) * 100), 0)::bigint as tip
    from orders o left join lateral
      (select sum(amount - tip) as principal, sum(tip) as tip from payment_allocations where order_id = o.id) a on true
    where o.id = any(p.allocation_scope) and o.restaurant_id = p.restaurant_id
      and (p.allocation_origin = 'legacy' or (o.status <> 'cancelled' and not o.written_off))
  ), weights as (
    select *, sum(principal) over() as ps, sum(tip) over() as ts from needs
  ), shares as (
    select *, least(v_principal, ps) * principal / nullif(ps, 0) as raw_p,
      least(v_tip, ts) * tip / nullif(ts, 0) as raw_t from weights
  ), ranks as (
    select *, row_number() over(order by raw_p - floor(raw_p) desc nulls last, created_at, id) as rp,
      row_number() over(order by raw_t - floor(raw_t) desc nulls last, created_at, id) as rt,
      sum(coalesce(floor(raw_p), 0)) over() as fp, sum(coalesce(floor(raw_t), 0)) over() as ft from shares
  ), amounts as (
    select id, coalesce(floor(raw_p), 0) + case when rp <= least(v_principal, ps) - fp then 1 else 0 end as pc,
      coalesce(floor(raw_t), 0) + case when rt <= least(v_tip, ts) - ft then 1 else 0 end as tc from ranks
  )
  insert into payment_allocations(restaurant_id, payment_id, order_id, amount, tip, provenance)
    select p.restaurant_id, p.id, id, (pc + tc) / 100, tc / 100, 'exact' from amounts where pc + tc > 0;
  select coalesce(round(sum(amount) * 100), 0) into v_total from payment_allocations where payment_id = p.id;
  if v_total <> round(p.amount * 100) then raise exception 'receipt exceeds verified order coverage'; end if;
  update payments set unallocated_amount = p.amount - v_total / 100.0,
    unallocated_tip = p.tip - coalesce((select sum(tip) from payment_allocations where payment_id = p.id), 0),
    allocation_quality = case when v_total = round(p.amount * 100) then 'exact' else 'unresolved' end,
    allocation_reason = case when v_total <> round(p.amount * 100) then 'Receipt exceeds verified order coverage' end
    where id = p.id;
  perform set_config('tabletap.allocating', '', true);
  if exists(select 1 from payments r where r.id = p.id and
    (r.unallocated_amount + coalesce((select sum(amount) from payment_allocations where payment_id = p.id), 0) <> r.amount
    or r.unallocated_tip + coalesce((select sum(tip) from payment_allocations where payment_id = p.id), 0) <> r.tip)) then
    raise exception 'receipt allocation does not reconcile';
  end if;
end;
$$;
revoke all on function public.allocate_receipt(uuid) from public, anon, authenticated;
grant execute on function public.allocate_receipt(uuid) to service_role;
create or replace function public.finish_payment_allocation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.allocate_receipt(new.id);
  return null;
end;
$$;
revoke all on function public.finish_payment_allocation() from public, anon, authenticated;
drop trigger if exists finish_payment_allocation on payments;
create constraint trigger finish_payment_allocation after insert on payments
  deferrable initially deferred for each row execute function public.finish_payment_allocation();

create or replace function public.check_receipt_allocations()
returns trigger language plpgsql security definer set search_path = public as $$
declare p payments; v_amount numeric; v_tip numeric;
begin
  if tg_table_name = 'payments' then
    select * into p from payments where id = new.id;
  else
    select * into p from payments where id = new.payment_id;
  end if;
  if p.id is null or p.allocation_version <> 1 then return null; end if;
  if current_setting('tabletap.allocating', true) = p.id::text then return null; end if;
  select coalesce(sum(amount), 0), coalesce(sum(tip), 0) into v_amount, v_tip from payment_allocations where payment_id = p.id;
  if v_amount + p.unallocated_amount <> p.amount or v_tip + p.unallocated_tip <> p.tip then
    raise exception 'receipt allocation does not reconcile';
  end if;
  return null;
end;
$$;
revoke all on function public.check_receipt_allocations() from public, anon, authenticated;
drop trigger if exists check_receipt_allocations on payments;
drop trigger if exists z_check_receipt_allocations on payments;
create constraint trigger z_check_receipt_allocations after insert or update on payments
  deferrable initially deferred for each row execute function public.check_receipt_allocations();
drop trigger if exists check_receipt_allocations on payment_allocations;
create constraint trigger check_receipt_allocations after insert or update on payment_allocations
  deferrable initially deferred for each row execute function public.check_receipt_allocations();

-- Old receipt tip metadata can be missing. That exception is named, not
-- silently treated as proof that all historical money paid for food.
create or replace function public.order_component_capacity(p_restaurant uuid, p_order uuid)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('principal', o.total - o.tip - coalesce(sum(a.amount - a.tip), 0),
    'tip', o.tip - coalesce(sum(a.tip), 0),
    'breakdown_unknown', coalesce(bool_or(p.breakdown_unknown), false))
  from orders o left join payment_allocations a on a.order_id = o.id and a.restaurant_id = p_restaurant
    left join payments p on p.id = a.payment_id
  where o.id = p_order and o.restaurant_id = p_restaurant group by o.id;
$$;
revoke all on function public.order_component_capacity(uuid, uuid) from public, anon, authenticated;
grant execute on function public.order_component_capacity(uuid, uuid) to service_role;

-- A historical return is imported only when one complete log line identifies
-- one order and this exact group of receipts. Its old financial effect stays
-- in the old log readers; the typed record reserves coverage without doubling it.
create or replace function public.import_historical_return(p_restaurant uuid, p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare o orders; d uuid; g record; v_log uuid; v_count int; v_operation uuid; l user_logs;
begin
  perform public.lock_restaurant_money(p_restaurant);
  perform set_config('tabletap.importing_return', 'v1', true);
  select * into o from orders where id = p_order and restaurant_id = p_restaurant for update;
  if o.id is null or o.status <> 'cancelled' then return; end if;
  insert into order_adjustments(restaurant_id, order_id, kind, previous_total, previous_tip, actor, created_at)
    values(p_restaurant, o.id, 'cancel', o.total, o.tip, 'historical review', coalesce(o.cancelled_at, o.created_at))
    on conflict(order_id, kind) do nothing;
  select id into d from order_adjustments where order_id = o.id and kind = 'cancel';
  for g in select p.method, p.actor_email, p.currency, p.stripe_payment_intent, p.stripe_account_id,
      sum(a.amount) amount, sum(a.tip) tip, jsonb_agg(to_jsonb(a)) entries, f.id existing_operation
    from payment_allocations a join payments p on p.id = a.payment_id
    left join refund_allocations r on r.allocation_id = a.id
    left join refund_operations f on f.id = r.operation_id
    where a.restaurant_id = p_restaurant and a.order_id = o.id and p.allocation_origin = 'legacy'
      and (r.id is null or (f.historical_review and f.status = 'review'))
    group by p.method, p.actor_email, p.currency, p.stripe_payment_intent, p.stripe_account_id, f.id loop
    v_log := null;
    -- Truncated order codes and duplicated logs are ambiguous; neither proves a return.
    if (select count(*) from orders where restaurant_id = p_restaurant and left(id::text, 8) = left(o.id::text, 8)) = 1 then
      select count(*), (array_agg(id))[1] into v_count, v_log from user_logs
        where restaurant_id = p_restaurant and entity = 'order' and action = 'refunded'
          and substring(detail from '(?:^| )order=([^ ]+)') = left(o.id::text, 8)
          and substring(detail from '(?:^| )amount=([0-9]+(?:[.][0-9]+)?)(?: |$)')::numeric = g.amount
          and substring(detail from '(?:^| )method=([^ ]+)') = g.method
          and replace(substring(detail from '(?:^| )collector=([^ ]+)'), '_', ' ') is not distinct from g.actor_email
          and not exists(select 1 from refund_operations f where f.historical_log_id = user_logs.id);
      if v_count <> 1 then v_log := null; end if;
    end if;
    -- An old log did not verify Stripe's provider status; keep that for review.
    if g.stripe_payment_intent is not null or g.currency is distinct from o.currency then v_log := null; end if;
    select * into l from user_logs where id = v_log;
    if g.existing_operation is not null then
      if v_log is not null then
        update refund_operations set status = 'succeeded', historical_log_id = v_log,
          completed_at = l.created_at, payout_actor = g.actor_email, confirmed_by = l.actor_email
          where id = g.existing_operation and historical_review and status = 'review';
      end if;
      continue;
    end if;
    insert into refund_operations(restaurant_id, adjustment_id, source, amount, tip, currency,
      stripe_payment_intent, stripe_account_id, original_collector, status, historical_log_id, completed_at, payout_actor, confirmed_by, historical_review)
      values(p_restaurant, d, case when g.stripe_payment_intent is not null or g.currency is distinct from o.currency then 'review'
        when g.method = 'cash' then 'cash' else 'terminal' end,
        g.amount, g.tip, coalesce(g.currency, o.currency), g.stripe_payment_intent, g.stripe_account_id, g.actor_email,
        case when v_log is null then 'review' else 'succeeded' end, v_log, l.created_at,
        case when v_log is not null then g.actor_email end, l.actor_email, true) returning id into v_operation;
    insert into refund_allocations(restaurant_id, operation_id, allocation_id, amount, tip)
      select p_restaurant, v_operation, (x->>'id')::uuid, (x->>'amount')::numeric, (x->>'tip')::numeric
        from jsonb_array_elements(g.entries) x;
  end loop;
end;
$$;
revoke all on function public.import_historical_return(uuid, uuid) from public, anon, authenticated;
grant execute on function public.import_historical_return(uuid, uuid) to service_role;

-- Historical ambiguity is recorded, never turned into invented receipts.
create or replace function public.backfill_payment_allocations(p_restaurant uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p payments; v_exact int := 0; v_unresolved int := 0; v_restaurant uuid; v_order uuid;
begin
  -- Old and new writers take this same lock before looking at money. Loop by
  -- tenant so the deployment backfill never reverses their lock ordering.
  for v_restaurant in select id from restaurants where p_restaurant is null or id = p_restaurant order by id loop
    perform public.lock_restaurant_money(v_restaurant);
    for p in select * from payments where restaurant_id = v_restaurant
      and (allocation_version = 0 or (allocation_quality = 'unresolved' and allocation_origin = 'legacy'
        and allocation_reason = 'Overlap receipt needs manager evidence'))
      order by created_at, id for update loop
      if p.order_id is not null and exists(select 1 from orders where id = p.order_id and restaurant_id = p.restaurant_id) then
        insert into payment_allocations(restaurant_id, payment_id, order_id, amount, tip, provenance)
          values(p.restaurant_id, p.id, p.order_id, p.amount, p.tip, 'exact');
        update payments set allocation_version = 1, allocation_quality = 'exact', allocation_scope = array[p.order_id],
          unallocated_amount = 0, unallocated_tip = 0, currency = (select currency from orders where id = p.order_id),
          breakdown_unknown = exists(select 1 from orders where id = p.order_id and tip <> p.tip),
          allocation_reason = 'Historical explicit order; tip metadata preserved' where id = p.id;
        v_exact := v_exact + 1;
      elsif cardinality(p.allocation_scope) > 0 and p.currency is not null then
        -- These are overlap receipts snapshotted at insertion, before later
        -- rounds could join. A failed proof leaves the receipt unresolved.
        begin
          update payments set allocation_version = 1, allocation_quality = 'exact',
            unallocated_amount = amount, unallocated_tip = tip where id = p.id;
          perform public.allocate_receipt(p.id);
          v_exact := v_exact + 1;
        exception when raise_exception then
          update payments set allocation_version = 1, allocation_quality = 'unresolved',
            unallocated_amount = amount, unallocated_tip = tip,
            allocation_reason = 'Overlap receipt needs manager evidence' where id = p.id;
          v_unresolved := v_unresolved + 1;
        end;
      else
        update payments set allocation_version = 1, allocation_quality = 'unresolved',
          unallocated_amount = amount, unallocated_tip = tip, currency = null,
          allocation_reason = 'Historical pooled receipt; currency and attribution evidence required' where id = p.id;
        v_unresolved := v_unresolved + 1;
      end if;
    end loop;
    -- `p` is this function's loop variable: the receipt table needs its own alias.
    for v_order in select distinct a.order_id from payment_allocations a join orders o on o.id = a.order_id
      join payments rp on rp.id = a.payment_id where a.restaurant_id = v_restaurant
        and rp.allocation_origin = 'legacy' and o.status = 'cancelled' order by a.order_id loop
      perform public.import_historical_return(v_restaurant, v_order);
    end loop;
  end loop;
  return jsonb_build_object('exact', v_exact, 'unresolved', v_unresolved);
end;
$$;
revoke all on function public.backfill_payment_allocations(uuid) from public, anon, authenticated;
grant execute on function public.backfill_payment_allocations(uuid) to service_role;

-- Versioned to keep old application instances from adding this tip twice.
-- Its full writer is defined below, after the reconciliation helpers.

-- Private financial records. Parent-restaurant cascades remain available for
-- the existing account-deletion flow and isolated fixture cleanup.
alter table payment_allocations enable row level security;
alter table order_adjustments enable row level security;
alter table refund_operations enable row level security;
alter table refund_allocations enable row level security;
alter table refund_attempts enable row level security;
revoke all on payment_allocations, order_adjustments, refund_operations, refund_allocations, refund_attempts from public, anon, authenticated;
grant select, insert, update, delete on payment_allocations, order_adjustments, refund_operations, refund_allocations, refund_attempts to service_role;

-- Only retained coverage can be returned. Reserved/failed attempts remain
-- obligations and cannot be spent again while their provider outcome is unknown.
create or replace function public.order_refund_coverage(p_restaurant uuid, p_order uuid)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
    select a.id, a.payment_id,
      a.amount - coalesce(r.amount, 0) as amount, a.tip - coalesce(r.tip, 0) as tip,
      p.method, p.actor_email, p.currency, p.stripe_payment_intent, p.stripe_account_id,
      p.allocation_quality
    from payment_allocations a join payments p on p.id = a.payment_id
    left join lateral (select sum(amount) as amount, sum(tip) as tip
      from refund_allocations where allocation_id = a.id) r on true
    where a.restaurant_id = p_restaurant and a.order_id = p_order
      and a.amount > coalesce(r.amount, 0)
  ) x;
$$;
revoke all on function public.order_refund_coverage(uuid, uuid) from public, anon, authenticated;
grant execute on function public.order_refund_coverage(uuid, uuid) to service_role;

create or replace function public.prepare_order_refund(
  p_restaurant uuid, p_order uuid, p_actor text, p_legacy_demand jsonb,
  p_expected_paid boolean, p_expected_account uuid, p_expected_hold timestamptz, p_expected_checkout uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o orders;
  v_adjustment uuid;
  v_operation uuid;
  c jsonb;
  g record;
  v_covered numeric := 0;
begin
  perform public.lock_restaurant_money(p_restaurant);
  if p_expected_account is not null then
    perform 1 from customer_accounts where id = p_expected_account and restaurant_id = p_restaurant for update;
  end if;
  select * into o from orders where restaurant_id = p_restaurant and id = p_order for update;
  if o.id is null then return jsonb_build_object('outcome', 'missing'); end if;
  select id into v_adjustment from order_adjustments where order_id = o.id and kind = 'cancel';
  if v_adjustment is not null then
    return jsonb_build_object('outcome', 'cancelled', 'adjustment', v_adjustment);
  end if;
  if (public.order_coverage(p_restaurant, array[o.id])->0->>'unresolved')::boolean
    or (o.paid and public.retained_order_coverage(p_restaurant, o.id) < o.total) then
    return jsonb_build_object('outcome', 'review');
  end if;
  perform set_config('tabletap.refund_writer', 'v1', true);
  perform set_config('tabletap.allocation_writer', 'v1', true);
  if not public.cancel_order_v2(p_restaurant, p_order, null, p_legacy_demand,
    p_expected_paid, p_expected_account, p_expected_hold, p_expected_checkout) then
    return jsonb_build_object('outcome', 'changed');
  end if;
  insert into order_adjustments(restaurant_id, order_id, kind, previous_total, previous_tip, actor)
    values(p_restaurant, o.id, 'cancel', o.total, o.tip, p_actor) returning id into v_adjustment;
  c := public.order_refund_coverage(p_restaurant, o.id);
  for g in select
      case when x->>'currency' is distinct from o.currency then 'review'
        when x->>'allocation_quality' <> 'exact' and x->>'stripe_payment_intent' is not null then 'review'
        when x->>'stripe_payment_intent' is not null and x->>'stripe_account_id' is not null then 'stripe'
        when x->>'stripe_payment_intent' is not null then 'review'
        when x->>'method' = 'cash' then 'cash' else 'terminal' end as source,
      x->>'currency' as currency, x->>'stripe_account_id' as account,
      x->>'stripe_payment_intent' as intent,
      case when x->>'stripe_payment_intent' is null then x->>'actor_email' end as collector,
      sum((x->>'amount')::numeric) as amount, sum((x->>'tip')::numeric) as tip,
      jsonb_agg(x) as entries
    from jsonb_array_elements(c) x group by 1, 2, 3, 4, 5 loop
    insert into refund_operations(restaurant_id, adjustment_id, source, amount, tip, currency,
      stripe_account_id, stripe_payment_intent, original_collector, status)
      values(p_restaurant, v_adjustment, g.source, g.amount, g.tip, coalesce(g.currency, o.currency),
        g.account, g.intent, g.collector, case when g.source = 'review' then 'review' else 'pending' end)
      returning id into v_operation;
    insert into refund_allocations(restaurant_id, operation_id, allocation_id, amount, tip)
      select p_restaurant, v_operation, (x->>'id')::uuid, (x->>'amount')::numeric, (x->>'tip')::numeric
        from jsonb_array_elements(g.entries) x;
    v_covered := v_covered + g.amount;
  end loop;
  -- Historical pooled money stays visible, but no provider/drawer is guessed.
  if o.paid and v_covered < o.total then
    insert into refund_operations(restaurant_id, adjustment_id, source, amount, tip, currency, status)
      values(p_restaurant, v_adjustment, 'review', o.total - v_covered, 0, o.currency, 'review');
  end if;
  -- Cancellation changes the frozen meal. Outstanding shares must be reviewed
  -- before taking more money for that old meal; late charges become refunds due.
  update bill_splits set status = 'cancelled' where session_id = o.session_id and status in ('proposed', 'locked');
  insert into user_logs(restaurant_id, actor_email, entity, action, detail)
    values(p_restaurant, p_actor, 'order', 'cancelled', 'order=' || left(o.id::text, 8));
  return jsonb_build_object('outcome', 'cancelled', 'adjustment', v_adjustment);
end;
$$;
revoke all on function public.prepare_order_refund(uuid, uuid, text, jsonb, boolean, uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.prepare_order_refund(uuid, uuid, text, jsonb, boolean, uuid, timestamptz, uuid) to service_role;

-- An attempt is saved before a provider is called. The same immutable request
-- and key survive a lost HTTP response, process crash, or repeated button tap.
create or replace function public.start_refund_attempt(p_restaurant uuid, p_operation uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o refund_operations; a refund_attempts; v_order uuid; v_no int;
begin
  perform public.lock_restaurant_money(p_restaurant);
  select * into o from refund_operations where id = p_operation and restaurant_id = p_restaurant for update;
  if o.id is null or o.source <> 'stripe' or o.status = 'review' then return null; end if;
  select * into a from refund_attempts where operation_id = o.id order by attempt_no desc limit 1;
  if a.id is null or (o.status = 'failed' and a.provider_status in ('failed', 'canceled')) then
    v_no := coalesce(a.attempt_no, 0) + 1;
    select order_id into v_order from order_adjustments where id = o.adjustment_id;
    insert into refund_attempts(restaurant_id, operation_id, attempt_no, idempotency_key, amount, stripe_account_id, stripe_payment_intent)
      values(p_restaurant, o.id, v_no,
        case when v_no = 1 then 'cancel-' || v_order || '-' || o.stripe_payment_intent else 'return-' || o.id || '-' || v_no end,
        o.amount, o.stripe_account_id, o.stripe_payment_intent) returning * into a;
  end if;
  if o.status <> 'succeeded' then update refund_operations set status = 'processing' where id = o.id; end if;
  return to_jsonb(a) || jsonb_build_object('operation_status', o.status);
end;
$$;
revoke all on function public.start_refund_attempt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_refund_attempt(uuid, uuid) to service_role;

drop function if exists public.finish_refund_operation(uuid, uuid, text, text, text);
drop function if exists public.finish_refund_operation(uuid, uuid, text, text, text, text);
create or replace function public.finish_refund_operation(
  p_restaurant uuid, p_operation uuid, p_actor text, p_refund text, p_status text, p_payout text default null, p_attempt uuid default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare o refund_operations;
begin
  perform public.lock_restaurant_money(p_restaurant);
  select * into o from refund_operations where id = p_operation and restaurant_id = p_restaurant for update;
  if o.id is null then return false; end if;
  if o.status = 'succeeded' then return true; end if;
  if o.source = 'stripe' and p_attempt is distinct from
    (select id from refund_attempts where operation_id = o.id order by attempt_no desc limit 1) then return false; end if;
  if o.source = 'stripe' and p_refund is null then raise exception 'provider refund required'; end if;
  if o.source <> 'stripe' and (o.source = 'review' or p_refund is not null) then raise exception 'review required'; end if;
  if p_status not in ('succeeded', 'pending', 'requires_action', 'failed', 'canceled') then raise exception 'invalid refund status'; end if;
  update refund_attempts set stripe_refund_id = p_refund, provider_status = p_status, updated_at = now()
    where operation_id = o.id and id = p_attempt;
  update refund_operations set stripe_refund_id = p_refund, provider_status = p_status,
    status = case when p_status = 'succeeded' then 'succeeded' when p_status in ('failed', 'canceled') then 'failed' else 'processing' end,
    completed_at = case when p_status = 'succeeded' then now() end,
    fee_verification_pending = (source = 'stripe'),
    confirmed_by = p_actor,
    payout_actor = case when source = 'stripe' then null else coalesce(p_payout, original_collector) end where id = o.id;
  -- Financial readers consume typed returns. No mirrored refunded activity row
  -- is written, which would make old log readers subtract the same money twice.
  return true;
end;
$$;
revoke all on function public.finish_refund_operation(uuid, uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.finish_refund_operation(uuid, uuid, text, text, text, text, uuid) to service_role;
-- Coverage stays attached to the dish it paid, including while a return is
-- pending. It is never a reusable balance on the rest of the table.
create or replace function public.retained_order_coverage(p_restaurant uuid, p_order uuid)
returns numeric language sql security definer set search_path = public as $$
  select coalesce(sum(a.amount - coalesce(r.amount, 0)), 0)
  from payment_allocations a left join lateral
    (select sum(amount) amount from refund_allocations where allocation_id = a.id) r on true
  where a.restaurant_id = p_restaurant and a.order_id = p_order;
$$;
revoke all on function public.retained_order_coverage(uuid, uuid) from public, anon, authenticated;
grant execute on function public.retained_order_coverage(uuid, uuid) to service_role;

create or replace function public.guard_allocated_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_covered numeric;
begin
  if current_setting('tabletap.allocation_writer', true) is distinct from 'v1' then return new; end if;
  if pg_trigger_depth() > 1 then return new; end if;
  v_covered := public.retained_order_coverage(old.restaurant_id, old.id);
  if v_covered > 0 and (new.written_off or new.account_id is distinct from old.account_id
    or ((new.total <> old.total or new.tip <> old.tip)
      and (new.tip < old.tip or new.total - old.total <> new.tip - old.tip))) then
    -- A quoted coupon can land after a partial collection. Only that frozen
    -- reduction is allowed, and it cannot consume anybody's existing receipt.
    if new.total >= v_covered and new.total < old.total and new.tip = old.tip
      and new.status = old.status and new.written_off = old.written_off
      and new.account_id is not distinct from old.account_id
      and old.total - new.total <= coalesce((select (c.order_discounts->>old.id::text)::numeric
        from diner_checkouts c where c.id::text = current_setting('tabletap.diner_discount', true)
          and c.stripe_payment_intent is not null and not c.discount_applied), 0) then return new; end if;
    raise exception 'allocated money requires an adjustment';
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' and v_covered > 0
    and current_setting('tabletap.refund_writer', true) is distinct from 'v1' then
    raise exception 'allocated money requires a refund obligation';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_allocated_order() from public, anon, authenticated;
drop trigger if exists guard_allocated_order on orders;
create trigger guard_allocated_order before update of total, tip, written_off, account_id, status on orders
  for each row execute function public.guard_allocated_order();

create or replace function public.check_refund_allocations()
returns trigger language plpgsql security definer set search_path = public as $$
declare a payment_allocations; o refund_operations; v_amount numeric; v_tip numeric;
begin
  select * into a from payment_allocations where id = new.allocation_id for update;
  select coalesce(sum(amount), 0), coalesce(sum(tip), 0) into v_amount, v_tip
    from refund_allocations where allocation_id = a.id;
  if v_amount > a.amount or v_tip > a.tip or v_amount - v_tip > a.amount - a.tip then
    raise exception 'return exceeds original coverage';
  end if;
  select * into o from refund_operations where id = new.operation_id;
  if not exists(select 1 from order_adjustments d where d.id = o.adjustment_id and d.order_id = a.order_id) then
    raise exception 'return belongs to another order';
  end if;
  select coalesce(sum(amount), 0), coalesce(sum(tip), 0) into v_amount, v_tip
    from refund_allocations where operation_id = o.id;
  if v_amount <> o.amount or v_tip <> o.tip then raise exception 'return allocation does not reconcile'; end if;
  return null;
end;
$$;
revoke all on function public.check_refund_allocations() from public, anon, authenticated;
drop trigger if exists check_refund_allocations on refund_allocations;
create constraint trigger check_refund_allocations after insert or update on refund_allocations
  deferrable initially deferred for each row execute function public.check_refund_allocations();

create or replace function public.immutable_allocation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'financial attribution is immutable';
end;
$$;
revoke all on function public.immutable_allocation() from public, anon, authenticated;
drop trigger if exists immutable_allocation on payment_allocations;
create trigger immutable_allocation before update or delete on payment_allocations
  for each row execute function public.immutable_allocation();
drop trigger if exists immutable_allocation on refund_allocations;
create trigger immutable_allocation before update or delete on refund_allocations
  for each row execute function public.immutable_allocation();

-- One authoritative live balance for every table reader. Unresolved historical
-- pooled money is refused rather than charged a second time.
create or replace function public.order_coverage(p_restaurant uuid, p_orders uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.backfill_payment_allocations(p_restaurant);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', o.id,
    'unresolved', exists(select 1 from payments p where p.restaurant_id = p_restaurant and p.allocation_quality = 'unresolved'
      and (p.order_id = o.id or (p.order_id is null and ((p.account_id is not null and p.account_id = o.account_id)
        or (p.account_id is null and p.session_id = o.session_id and o.account_id is null))))),
    'amount', public.retained_order_coverage(p_restaurant, o.id),
    'tip', (select coalesce(sum(a.tip - coalesce(r.tip, 0)), 0) from payment_allocations a
      left join lateral(select sum(tip) tip from refund_allocations where allocation_id = a.id) r on true
      where a.restaurant_id = p_restaurant and a.order_id = o.id))), '[]')
  from orders o where o.restaurant_id = p_restaurant and o.id = any(p_orders));
end;
$$;
revoke all on function public.order_coverage(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.order_coverage(uuid, uuid[]) to service_role;

create or replace function public.check_paid_coverage()
returns trigger language plpgsql security definer set search_path = public as $$
declare o orders; v_capacity jsonb;
begin
  if current_setting('tabletap.allocation_writer', true) is distinct from 'v1' then return null; end if;
  select * into o from orders where id = new.id;
  if o.id is null or not o.paid or o.written_off or o.status = 'cancelled' then return null; end if;
  perform public.allocate_receipt(p.id) from payments p where p.restaurant_id = o.restaurant_id
    and o.id = any(p.allocation_scope) and p.allocation_version = 1 and p.allocation_quality = 'exact'
    and not exists(select 1 from payment_allocations a where a.payment_id = p.id) order by p.created_at, p.id;
  if current_setting('tabletap.allocation_writer', true) = 'v1'
    and public.retained_order_coverage(o.restaurant_id, o.id) < o.total then
    raise exception 'settled order lacks retained payment coverage';
  end if;
  v_capacity := public.order_component_capacity(o.restaurant_id, o.id);
  if not (v_capacity->>'breakdown_unknown')::boolean
    and ((v_capacity->>'principal')::numeric <> 0 or (v_capacity->>'tip')::numeric <> 0) then
    raise exception 'settled order lacks principal or tip coverage';
  end if;
  return null;
end;
$$;
revoke all on function public.check_paid_coverage() from public, anon, authenticated;
drop trigger if exists zz_check_paid_coverage on orders;
create constraint trigger zz_check_paid_coverage after update of paid, total, tip on orders
  deferrable initially deferred for each row execute function public.check_paid_coverage();

create or replace function public.sync_refunded_platform_fee(p_restaurant uuid, p_intent text, p_cents int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_cents < 0 then raise exception 'invalid returned fee'; end if;
  update platform_fees set refunded_cents = least(cents, greatest(refunded_cents, p_cents))
    where restaurant_id = p_restaurant and stripe_payment_intent = p_intent and status = 'taken';
  -- An old caller can sync the ledger, but only a verified cumulative target
  -- can finish an operation's fee recovery (including a verified zero).
end;
$$;
revoke all on function public.sync_refunded_platform_fee(uuid, text, int) from public, anon, authenticated;
grant execute on function public.sync_refunded_platform_fee(uuid, text, int) to service_role;

create or replace function public.verify_refunded_platform_fee(p_restaurant uuid, p_intent text, p_cents int, p_target int, p_refunds text[] default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_returned int;
begin
  perform public.lock_restaurant_money(p_restaurant);
  if p_cents is null or p_target is null or p_cents < 0 or p_target < 0 then raise exception 'invalid verified fee'; end if;
  if p_refunds is null and p_target <> 0 then raise exception 'missing fee refund evidence'; end if;
  perform public.sync_refunded_platform_fee(p_restaurant, p_intent, p_cents);
  -- Two verifications can read the provider in one order and take the lock in
  -- the other. Refunds only add up, so the target and what came back are
  -- high-water marks: a stale snapshot can never lower the target and finish
  -- a row whose newer, larger target is still owed (audit N finding 1).
  select greatest(p_cents, coalesce(max(refunded_cents), 0)) into v_returned from platform_fees
    where restaurant_id = p_restaurant and stripe_payment_intent = p_intent and status = 'taken';
  -- A refund completed after the provider snapshot must wait for its own check.
  update refund_operations set fee_target_cents = greatest(coalesce(fee_target_cents, 0), p_target),
    fee_verification_pending = (v_returned < greatest(coalesce(fee_target_cents, 0), p_target)),
    fee_reconciled_at = case when v_returned >= greatest(coalesce(fee_target_cents, 0), p_target) then coalesce(fee_reconciled_at, now()) end
    where restaurant_id = p_restaurant and stripe_payment_intent = p_intent
      and status = 'succeeded' and source = 'stripe'
      and (p_refunds is null or stripe_refund_id = any(p_refunds));
  -- Duplicate-charge recovery must use this final snapshot too. A manual
  -- refund between provider reads can leave more of our fee still owed.
  update refunds_due set fee_target_cents = greatest(coalesce(fee_target_cents, 0), p_target),
    fee_verification_pending = (v_returned < greatest(coalesce(fee_target_cents, 0), p_target)),
    fee_reconciled_at = case when v_returned >= greatest(coalesce(fee_target_cents, 0), p_target) then coalesce(fee_reconciled_at, now()) end
    where restaurant_id = p_restaurant and stripe_payment_intent = p_intent
      and refunded_at is not null
      and (p_refunds is null or stripe_refund_id = any(p_refunds));
end;
$$;
revoke all on function public.verify_refunded_platform_fee(uuid, text, int, int, text[]) from public, anon, authenticated;
grant execute on function public.verify_refunded_platform_fee(uuid, text, int, int, text[]) to service_role;

-- A manager may attribute an ambiguous historical receipt, never change it.
drop function if exists public.attribute_payment(uuid, uuid, text, jsonb);
-- The submitted cents are evidence supplied by that manager, not a claim
-- that today's orders prove how the old pooled payment was collected.
create or replace function public.attribute_payment(
  p_restaurant uuid, p_payment uuid, p_actor text, p_entries jsonb,
  p_currency text default null, p_evidence text default null, p_breakdown_unknown boolean default false
) returns boolean language plpgsql security definer set search_path = public as $$
declare p payments; x jsonb; v_amount numeric; v_tip numeric; v_capacity jsonb;
begin
  perform public.lock_restaurant_money(p_restaurant);
  perform public.backfill_payment_allocations(p_restaurant);
  select * into p from payments where id = p_payment and restaurant_id = p_restaurant for update;
  if p.id is null or p.allocation_quality <> 'unresolved' then return false; end if;
  p_currency := upper(coalesce(p_currency, p.currency));
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' or (p.currency is not null and p.currency <> p_currency)
    or length(trim(coalesce(p_evidence, ''))) < 8 then raise exception 'original receipt evidence required'; end if;
  if p_breakdown_unknown and p.allocation_origin <> 'legacy' then raise exception 'only historical breakdown may be unknown'; end if;
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) not between 1 and 100 then
    raise exception 'invalid attribution';
  end if;
  perform 1 from orders where restaurant_id = p_restaurant and id in
    (select (e->>'orderId')::uuid from jsonb_array_elements(p_entries) e) order by id for update;
  for x in select * from jsonb_array_elements(p_entries) loop
    v_amount := (x->>'amount')::numeric;
    v_tip := (x->>'tip')::numeric;
    if not exists(select 1 from orders o where o.id = (x->>'orderId')::uuid and o.restaurant_id = p_restaurant
      and o.currency = p_currency and (p.allocation_origin = 'legacy' or (o.status <> 'cancelled' and not o.written_off))
      and ((p.order_id is not null and p.order_id = o.id)
        or (p.account_id is not null and p.account_id = o.account_id)
        or (p.session_id is not null and p.session_id = o.session_id and o.account_id is null))
      -- Returned coverage still consumes the original receipt's capacity.
      and coalesce((select sum(amount) from payment_allocations where order_id = o.id), 0) + v_amount <= o.total) then
      raise exception 'attribution exceeds eligible order';
    end if;
    v_capacity := public.order_component_capacity(p_restaurant, (x->>'orderId')::uuid);
    if not p_breakdown_unknown and not (v_capacity->>'breakdown_unknown')::boolean
      and (v_amount - v_tip > (v_capacity->>'principal')::numeric or v_tip > (v_capacity->>'tip')::numeric) then
      raise exception 'attribution exceeds principal or tip capacity';
    end if;
    insert into payment_allocations(restaurant_id, payment_id, order_id, amount, tip, provenance)
      values(p_restaurant, p.id, (x->>'orderId')::uuid, v_amount, v_tip, 'estimated');
  end loop;
  select coalesce(sum(amount), 0), coalesce(sum(tip), 0) into v_amount, v_tip
    from payment_allocations where payment_id = p.id;
  if v_amount <> p.amount or v_tip <> p.tip then raise exception 'attribute the entire remaining receipt'; end if;
  update payments set allocation_version = 1, allocation_quality = 'estimated', currency = p_currency,
    breakdown_unknown = p_breakdown_unknown, unallocated_amount = 0, unallocated_tip = 0,
    allocation_reason = 'Manager attribution: ' || p_actor || '; evidence: ' || trim(p_evidence) where id = p.id;
  insert into user_logs(restaurant_id, actor_email, entity, action, detail)
    values(p_restaurant, p_actor, 'bill', 'attributed', 'payment=' || p.id || ' currency=' || p_currency
      || ' breakdown_unknown=' || p_breakdown_unknown || ' evidence=' || replace(trim(p_evidence), ' ', '_'));
  perform public.import_historical_return(p_restaurant, (e->>'orderId')::uuid) from jsonb_array_elements(p_entries) e;
  return true;
end;
$$;
revoke all on function public.attribute_payment(uuid, uuid, text, jsonb, text, text, boolean) from public, anon, authenticated;
grant execute on function public.attribute_payment(uuid, uuid, text, jsonb, text, text, boolean) to service_role;

revoke all on payment_allocations from anon, authenticated;
revoke all on order_adjustments from anon, authenticated;
revoke all on refund_operations from anon, authenticated;
revoke all on refund_allocations from anon, authenticated;
revoke all on refund_attempts from anon, authenticated;
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

revoke truncate, references, trigger on all tables in schema public from public, anon, authenticated;

create or replace function public.guard_receipt_money()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  if new.amount is distinct from old.amount or new.restaurant_id is distinct from old.restaurant_id
    or new.order_id is distinct from old.order_id or new.session_id is distinct from old.session_id
    or new.account_id is distinct from old.account_id or new.method is distinct from old.method
    or new.actor_email is distinct from old.actor_email or new.stripe_payment_intent is distinct from old.stripe_payment_intent then
    raise exception 'receipt money is immutable';
  end if;
  if new.tip is distinct from old.tip and current_setting('tabletap.allocating', true) is distinct from old.id::text then
    raise exception 'receipt tip is immutable';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_receipt_money() from public, anon, authenticated;
drop trigger if exists guard_receipt_money on payments;
create trigger guard_receipt_money before update on payments for each row execute function public.guard_receipt_money();
revoke truncate, references, trigger on all tables in schema public from public, anon, authenticated;

revoke truncate, references, trigger on all tables in schema public from authenticated;

create or replace function public.check_return_header()
returns trigger language plpgsql security definer set search_path = public as $$
declare o refund_operations; v_amount numeric; v_tip numeric;
begin
  select * into o from refund_operations where id = new.id;
  if o.id is null then return null; end if;
  select coalesce(sum(amount), 0), coalesce(sum(tip), 0) into v_amount, v_tip
    from refund_allocations where operation_id = o.id;
  if o.source <> 'review' or v_amount > 0 then
    if v_amount <> o.amount or v_tip <> o.tip then raise exception 'return header does not reconcile'; end if;
  end if;
  if exists(select 1 from refund_allocations r join payment_allocations a on a.id = r.allocation_id
    join payments p on p.id = a.payment_id where r.operation_id = o.id and
    ((o.source <> 'review' and p.currency is distinct from o.currency) or
     (o.source = 'stripe' and (p.stripe_payment_intent is distinct from o.stripe_payment_intent
       or p.stripe_account_id is distinct from o.stripe_account_id)) or
     (o.source = 'cash' and (p.method <> 'cash' or p.stripe_payment_intent is not null)) or
     (o.source = 'terminal' and (p.method <> 'card' or p.stripe_payment_intent is not null)))) then
    raise exception 'return source differs from its receipt';
  end if;
  return null;
end;
$$;
revoke all on function public.check_return_header() from public, anon, authenticated;
drop trigger if exists check_return_header on refund_operations;
create constraint trigger check_return_header after insert or update on refund_operations
  deferrable initially deferred for each row execute function public.check_return_header();

create or replace function public.guard_return_money()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.historical_log_id is distinct from old.historical_log_id and
    (old.historical_log_id is not null or not old.historical_review or
      current_setting('tabletap.importing_return', true) is distinct from 'v1') then
    raise exception 'historical evidence is immutable';
  end if;
  -- Fee verification changes after customer completion; the return's money
  -- and original charge identity remain immutable throughout recovery.
  if (to_jsonb(new) - array['status','stripe_refund_id','provider_status','completed_at','payout_actor','confirmed_by','fee_reconciled_at','fee_verification_pending','fee_target_cents','historical_log_id'])
    is distinct from (to_jsonb(old) - array['status','stripe_refund_id','provider_status','completed_at','payout_actor','confirmed_by','fee_reconciled_at','fee_verification_pending','fee_target_cents','historical_log_id']) then
    raise exception 'return money is immutable';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_return_money() from public, anon, authenticated;
drop trigger if exists guard_return_money on refund_operations;
create trigger guard_return_money before update on refund_operations for each row execute function public.guard_return_money();
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- Versioned writers keep the deployed application working during overlap.
create or replace function public.join_bill_split_v2(
  p_split uuid, p_diner text, p_restaurant uuid, p_table uuid, p_session uuid
) returns int language plpgsql security definer set search_path = public as $$
declare
  v_split bill_splits%rowtype;
  v_sitting table_sessions%rowtype;
  v_taken int;
  v_next int;
  v_amount numeric;
  v_freeze timestamptz;
begin
  perform public.lock_restaurant_money(p_restaurant);
  perform set_config('tabletap.allocation_writer', 'v1', true);
  if p_restaurant is not null then perform public.backfill_payment_allocations(p_restaurant); end if;
  select * into v_split from bill_splits where id = p_split;
  if not found then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_split.session_id::text, 0));
  select * into v_split from bill_splits where id = p_split for update;
  select * into v_sitting from table_sessions where id = v_split.session_id for update;
  -- A split id cannot borrow a cheaper table's sitting or restaurant.
  if v_split.session_id is distinct from p_session
     or v_split.restaurant_id is distinct from p_restaurant
     or v_sitting.restaurant_id is distinct from v_split.restaurant_id
     or v_sitting.table_id is distinct from p_table
     or v_split.status <> 'proposed' or v_split.expires_at <= now() then return null; end if;

  select share_no into v_next from bill_split_claims
   where split_id = p_split and diner = p_diner;
  if v_next is not null then return v_next; end if;
  select count(*) into v_taken from bill_split_claims where split_id = p_split;
  if v_taken >= v_split.shares then return null; end if;

  perform 1 from orders where session_id = v_split.session_id
    and restaurant_id = v_split.restaurant_id and table_id = v_sitting.table_id
    order by id for update;
  v_freeze := clock_timestamp();
  select coalesce(sum(greatest(total - public.retained_order_coverage(p_restaurant, id), 0)), 0) into v_amount from orders
   where session_id = v_split.session_id and restaurant_id = v_split.restaurant_id
     and table_id = v_sitting.table_id and paid = false and written_off = false
     and account_id is null and status not in ('cancelled', 'pending_payment')
     and created_at < v_freeze;
  if v_amount <= 0 then return null; end if;

  v_next := v_taken;
  insert into bill_split_claims (split_id, share_no, diner) values (p_split, v_next, p_diner);
  if v_taken + 1 = v_split.shares then
    update bill_splits set status = 'locked', locked_at = v_freeze, amount = round(v_amount, 2),
      food_principal = (select coalesce(sum(greatest(o.total - public.retained_order_coverage(p_restaurant, o.id)
        - greatest(o.tip - coalesce((select sum(a.tip) from payment_allocations a where a.order_id = o.id), 0), 0), 0)), 0)
        from orders o where o.session_id = v_split.session_id and o.restaurant_id = v_split.restaurant_id
          and o.table_id = v_sitting.table_id and not o.paid and not o.written_off and o.account_id is null
          and o.status not in ('cancelled', 'pending_payment') and o.created_at < v_freeze),
      order_ids = array(select id from orders where session_id = v_split.session_id
        and restaurant_id = v_split.restaurant_id and table_id = v_sitting.table_id
        and not paid and not written_off and account_id is null
        and status not in ('cancelled', 'pending_payment') and created_at < v_freeze order by created_at, id)
     where id = p_split;
    -- Shares are ready before the lock becomes visible to a paying phone.
    update bill_split_claims
       set amount = (floor(round(v_amount * 100) / v_split.shares)
         + case when share_no = 0 then mod(round(v_amount * 100), v_split.shares) else 0 end) / 100
     where split_id = p_split;
  end if;
  return v_next;
end; $$;
revoke all on function public.join_bill_split_v2(uuid, text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.join_bill_split_v2(uuid, text, uuid, uuid, uuid) to service_role;

create or replace function public.close_divided_bill_v2(p_split uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_split bill_splits%rowtype;
  v_count int;
  v_shares numeric;
  v_owed numeric;
  v_collected numeric;
  v_spent numeric;
begin
  select * into v_split from bill_splits where id = p_split;
  if not found then return false; end if;
  perform public.lock_restaurant_money(v_split.restaurant_id);
  perform set_config('tabletap.allocation_writer', 'v1', true);
  if v_split.restaurant_id is not null then perform public.backfill_payment_allocations(v_split.restaurant_id); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_split.session_id::text, 0));
  select * into v_split from bill_splits where id = p_split for update;
  if v_split.status = 'done' then return true; end if;
  if v_split.status <> 'locked' then return false; end if;
  perform 1 from bill_split_claims where split_id = p_split order by share_no for update;
  select count(*), coalesce(sum(amount), 0) into v_count, v_shares
    from bill_split_claims where split_id = p_split and paid_at is not null;
  if v_count <> v_split.shares or v_shares < v_split.amount then return false; end if;

  perform 1 from orders where session_id = v_split.session_id
    and restaurant_id = v_split.restaurant_id order by id for update;
  select coalesce(sum(total), 0) into v_owed from orders
   where session_id = v_split.session_id and restaurant_id = v_split.restaurant_id
     and id = any(v_split.order_ids) and paid = false and written_off = false
     and account_id is null and status not in ('cancelled', 'pending_payment');
  if exists(select 1 from orders o where o.id = any(v_split.order_ids)
    and o.restaurant_id = v_split.restaurant_id and not o.paid and not o.written_off and o.status <> 'cancelled'
    and public.retained_order_coverage(v_split.restaurant_id, o.id) < o.total) then return false; end if;
  update orders set paid = true, pay_method = 'card'
   where session_id = v_split.session_id and restaurant_id = v_split.restaurant_id
     and id = any(v_split.order_ids) and paid = false and written_off = false
     and account_id is null and status not in ('cancelled', 'pending_payment');
  update bill_splits set status = 'done' where id = p_split;
  return true;
end; $$;
revoke all on function public.close_divided_bill_v2(uuid) from public, anon, authenticated;
grant execute on function public.close_divided_bill_v2(uuid) to service_role;

create or replace function public.collect_on_sitting_v2(
  p_restaurant uuid,
  p_session    uuid,
  p_amount     numeric,
  p_tip        numeric,
  p_method     text,
  p_actor      text,
  p_ref        text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owed  numeric;
  v_paid  numeric;
  v_spent numeric;
  v_room  numeric;
  v_take  numeric;
  v_existing_tip numeric;
begin
  perform public.lock_restaurant_money(p_restaurant);
  perform set_config('tabletap.allocation_writer', 'v1', true);
  if p_restaurant is not null then perform public.backfill_payment_allocations(p_restaurant); end if;
  perform set_config('tabletap.allocation_scope', '', true);
  -- One collection at a time per sitting. Everything below reads live.
  perform pg_advisory_xact_lock(hashtextextended(p_session::text, 0));

  select coalesce(sum(total), 0) into v_owed
    from orders
   where session_id = p_session
     and paid = false
     and written_off = false
     and account_id is null
     and status <> 'cancelled'
     and status <> 'pending_payment';

  select coalesce(sum(public.retained_order_coverage(p_restaurant, id)), 0) into v_paid
    from orders where restaurant_id = p_restaurant and session_id = p_session
      and not paid and not written_off and account_id is null and status not in ('cancelled', 'pending_payment');
  if exists(select 1 from payments where restaurant_id = p_restaurant and session_id = p_session
    and order_id is null and allocation_quality = 'unresolved') then
    raise exception 'historical pooled money requires attribution';
  end if;
  v_room := round(v_owed - v_paid, 2);
  if v_room <= 0 then
    return jsonb_build_object('taken', 0, 'tip', 0, 'outcome', 'covered');
  end if;

  -- The ceiling is what is owed PLUS the gratuity this payment carries.
  --
  -- `payments.amount` is inclusive of its tip, and the order does not carry
  -- that tip yet — `addTip` puts it on the oldest order a moment after this
  -- returns. Capping against the food alone therefore truncates the tip off
  -- the share that carries it, which is the same food-versus-total confusion
  -- that once read a table owing MX$94.07 as MX$93.17. The caller pads the
  -- first sitting by the same amount before sharing out, for the same reason.
  v_take := least(round(p_amount, 2), round(v_room + coalesce(p_tip, 0), 2));
  if v_take <= 0 then
    return jsonb_build_object('taken', 0, 'tip', 0, 'outcome', 'covered');
  end if;

  -- Existing tip is part of the debt; p_tip is only the new gratuity.
  select coalesce(sum(greatest(o.tip - coalesce(a.tip, 0), 0)), 0) into v_existing_tip
    from orders o left join lateral(select sum(tip) tip from payment_allocations where order_id = o.id) a on true
    where o.restaurant_id = p_restaurant and o.session_id = p_session and not o.paid
      and not o.written_off and o.account_id is null and o.status not in ('cancelled', 'pending_payment');
  -- An explicitly unknown old breakdown cannot make the remaining tip
  -- larger than the whole remaining debt. The exception stays visible.
  v_existing_tip := least(v_room, v_existing_tip);
  v_existing_tip := least(v_existing_tip, round(greatest(v_take - coalesce(p_tip, 0), 0) * v_existing_tip / nullif(v_room, 0), 2));
  begin
    insert into payments (restaurant_id, session_id, amount, tip, method, actor_email, client_ref)
    values (p_restaurant, p_session, v_take, coalesce(p_tip, 0) + v_existing_tip, p_method, p_actor, p_ref);
  exception when unique_violation then
    -- The same collection arriving twice. The money is already in, once.
    return jsonb_build_object('taken', 0, 'tip', 0, 'outcome', 'duplicate');
  end;

  update bill_splits set status = 'cancelled' where restaurant_id = p_restaurant
    and session_id = p_session and status in ('proposed', 'locked');
  if coalesce(p_tip, 0) > 0 then
    update orders set total = total + p_tip, tip = tip + p_tip where id = (
      select id from orders where restaurant_id = p_restaurant and session_id = p_session
        and not paid and not written_off and account_id is null and status not in ('cancelled', 'pending_payment')
        order by created_at, id limit 1);
  end if;
  return jsonb_build_object('taken', v_take, 'tip', coalesce(p_tip, 0), 'outcome', 'written');
end;
$$;
revoke all on function public.collect_on_sitting_v2(uuid, uuid, numeric, numeric, text, text, text)
  from public, anon, authenticated;
grant execute on function public.collect_on_sitting_v2(uuid, uuid, numeric, numeric, text, text, text)
  to service_role;

-- Apply before deploying the batch caller. Keep collect_on_sitting_v2 for the
-- deployed caller: this wrapper reuses its coverage, tip and allocation rules.
create or replace function public.collect_on_sittings_v1(
  p_restaurant uuid,
  p_shares jsonb,
  p_method text,
  p_actor text,
  p_ref text,
  p_total numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session uuid;
  v_share jsonb;
  v_ref text;
  v_seen numeric;
  v_left numeric;
  v_tip numeric;
  v_amount numeric;
  v_outcome jsonb;
  v_outcomes jsonb := '[]'::jsonb;
begin
  if p_restaurant is null or p_method is null or p_method not in ('cash', 'card')
    or nullif(btrim(p_ref), '') is null or p_total is null or p_total <= 0
    or p_total::text in ('NaN', 'Infinity', '-Infinity') or p_total <> round(p_total, 2)
    or jsonb_typeof(p_shares) is distinct from 'array' then
    raise exception 'invalid collection';
  end if;
  if jsonb_array_length(p_shares) = 0 or exists (
    select 1 from jsonb_to_recordset(p_shares) as s(session_id uuid, amount numeric, tip numeric)
    where session_id is null or amount is null or amount <= 0 or amount <> round(amount, 2)
      or amount::text in ('NaN', 'Infinity', '-Infinity') or tip is null or tip < 0 or tip > amount
      or tip <> round(tip, 2) or tip::text in ('NaN', 'Infinity', '-Infinity')
      or not exists(select 1 from table_sessions t where t.id = s.session_id and t.restaurant_id = p_restaurant)
  ) or (select count(distinct (s->>'session_id')::uuid) from jsonb_array_elements(p_shares) s)
    <> jsonb_array_length(p_shares) or exists (
      select 1 from jsonb_array_elements(p_shares) with ordinality s(share, n)
        where n > 1 and (share->>'tip')::numeric <> 0
    ) then
    raise exception 'invalid collection shares';
  end if;

  -- Same order as the deployed sitting writer: restaurant, allocation
  -- backfill, then sitting. Bill, split and account writers share this lock.
  perform public.lock_restaurant_money(p_restaurant);
  perform set_config('tabletap.allocation_writer', 'v1', true);
  perform public.backfill_payment_allocations(p_restaurant);
  perform set_config('tabletap.allocation_scope', '', true);
  for v_session in select (s->>'session_id')::uuid from jsonb_array_elements(p_shares) s order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended(v_session::text, 0));
  end loop;

  -- Include old positional receipts too. A retry after an older caller's
  -- partial commit must finish that handful, never collect its first share
  -- or gratuity again. Subtract from the original request, not today's debt.
  select coalesce(sum(amount), 0) into v_seen from payments
    where restaurant_id = p_restaurant
      and (client_ref = p_ref or left(client_ref, length(p_ref) + 1) = p_ref || '#');
  v_left := greatest(0, p_total - v_seen);

  for v_share in select value from jsonb_array_elements(p_shares) loop
    v_session := (v_share->>'session_id')::uuid;
    select client_ref into v_ref from payments where restaurant_id = p_restaurant and session_id = v_session
      and (client_ref = p_ref or left(client_ref, length(p_ref) + 1) = p_ref || '#')
      order by created_at, id limit 1;
    if found or v_left <= 0 then
      v_outcome := jsonb_build_object('taken', 0, 'tip', 0, 'outcome', 'duplicate');
    else
      -- A single sitting keeps today's bare reference. Every multi-sitting
      -- receipt uses its sitting id, including when only one remains on retry.
      v_ref := case when jsonb_array_length(p_shares) = 1 and v_seen = 0 then p_ref
        else p_ref || '#' || v_session::text end;
      v_tip := case when v_seen > 0 then 0 else (v_share->>'tip')::numeric end;
      v_amount := least(v_left, (v_share->>'amount')::numeric - (v_share->>'tip')::numeric + v_tip);
      -- Do not catch errors here: a failure in any share, tip, allocation or
      -- split write must roll every earlier share back with it.
      v_outcome := public.collect_on_sitting_v2(p_restaurant, v_session, v_amount,
        least(v_tip, v_amount), p_method, p_actor, v_ref);
      v_left := v_left - (v_outcome->>'taken')::numeric;
    end if;
    if v_outcome->>'outcome' in ('written', 'duplicate') then
      -- Retrying also repairs a split left open after an old partial attempt.
      -- 'cancelled', as collect_on_sitting_v2 itself marks it when it writes.
      update bill_splits set status = 'cancelled' where restaurant_id = p_restaurant
        and session_id = v_session and status in ('proposed', 'locked');
    end if;
    v_outcomes := v_outcomes || jsonb_build_array(v_outcome);
  end loop;
  return v_outcomes;
end;
$$;
revoke all on function public.collect_on_sittings_v1(uuid, jsonb, text, text, text, numeric)
  from public, anon, authenticated;
grant execute on function public.collect_on_sittings_v1(uuid, jsonb, text, text, text, numeric)
  to service_role;

create or replace function public.settle_orders_v2(
  p_restaurant uuid,
  p_orders     uuid[],
  p_method     text,
  p_actor      text,
  p_sittings   jsonb
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  perform public.lock_restaurant_money(p_restaurant);
  perform set_config('tabletap.allocation_writer', 'v1', true);
  if p_restaurant is not null then perform public.backfill_payment_allocations(p_restaurant); end if;
  perform set_config('tabletap.allocation_scope', '', true);
  perform set_config('tabletap.allocation_scope', to_json(p_orders)::text, true);
  if p_method not in ('cash', 'card') then
    raise exception 'settle_orders: unknown method %', p_method;
  end if;
  if coalesce(cardinality(p_orders), 0) = 0 then
    raise exception 'not_owed';
  end if;
  -- A sitting is only ever this restaurant's own.
  if p_sittings is not null and exists (
    select 1 from jsonb_array_elements(p_sittings) p
     where not exists (
       select 1 from table_sessions s
        where s.id = (p->>'session_id')::uuid and s.restaurant_id = p_restaurant)
  ) then
    raise exception 'settle_orders: a sitting that is not this restaurant''s';
  end if;

  perform 1 from orders where restaurant_id = p_restaurant and id = any(p_orders) order by id for update;

  -- Closing a collected bill and collecting its remainder must use the same
  -- live coverage. A new round after the read cannot be marked paid for free.
  if p_sittings is not null and exists (
    select 1 from (
      select session_id, sum(total - public.retained_order_coverage(p_restaurant,id)) as owed
      from orders where restaurant_id = p_restaurant and id = any(p_orders)
        and not paid and not written_off and account_id is null and status not in ('cancelled','pending_payment')
      group by session_id
    ) debt full join (
      select (s->>'session_id')::uuid as session_id, sum((s->>'amount')::numeric) as amount
      from jsonb_array_elements(p_sittings) s group by 1
    ) receipt using(session_id)
    where abs(coalesce(debt.owed,0) - coalesce(receipt.amount,0)) > 0.005
  ) then raise exception 'not_owed'; end if;

  if p_sittings is null and exists(select 1 from orders where id = any(p_orders)
    and public.retained_order_coverage(p_restaurant, id) > 0) then raise exception 'not_owed'; end if;
  with settled as (
    update orders
       set paid = true, pay_method = p_method
     where restaurant_id = p_restaurant
       and id = any(p_orders)
       and paid = false
       and account_id is null
       and written_off = false
       and status <> 'pending_payment'
       and status <> 'cancelled'
    returning id, session_id, total
  ), written as (
    insert into payments (restaurant_id, order_id, session_id, amount, method, actor_email)
    select p_restaurant, s.id, s.session_id, round(s.total, 2), p_method, p_actor
      from settled s
     where p_sittings is null and s.total > 0
    returning 1
  )
  select count(*) into v_count from settled;

  -- All of them, or none: a bill that changed is looked at again.
  if v_count <> cardinality(p_orders) then
    raise exception 'not_owed';
  end if;

  if p_sittings is not null then
    insert into payments (restaurant_id, session_id, amount, tip, method, actor_email)
    select p_restaurant, (p->>'session_id')::uuid, round((p->>'amount')::numeric, 2),
      least(round((p->>'amount')::numeric, 2), (select coalesce(sum(greatest(o.tip - coalesce(a.tip, 0), 0)), 0)
        from orders o left join lateral (select sum(tip) tip from payment_allocations where order_id = o.id) a on true
        where o.id = any(p_orders) and o.session_id = (p->>'session_id')::uuid)), p_method, p_actor
      from jsonb_array_elements(p_sittings) p
     where (p->>'amount')::numeric > 0;
  end if;

  return v_count;
end;
$$;
revoke all on function public.settle_orders_v2(uuid, uuid[], text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.settle_orders_v2(uuid, uuid[], text, text, jsonb)
  to service_role;

create or replace function public.settle_card_orders_v2(
  p_orders    uuid[],
  p_intent    text,
  p_tip       numeric,
  p_tip_order uuid,
  p_status    text,
  -- Defaulted, so the call written before it existed still finds this function.
  p_charged   numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settled  uuid[];
  v_tip_on   uuid;
  v_missed   uuid[];
  v_recorded numeric;
  v_owed     numeric;
  v_rest     uuid;
  v_label    text;
  v_currency text;
  v_checkout diner_checkouts;
  v_discount record;
  v_off numeric;
  v_applied numeric := 0;
begin
  perform public.lock_restaurant_money((select restaurant_id from orders where id = any(p_orders) limit 1));
  perform set_config('tabletap.allocation_writer', 'v1', true);
  if (select restaurant_id from orders where id = any(p_orders) limit 1) is not null then perform public.backfill_payment_allocations((select restaurant_id from orders where id = any(p_orders) limit 1)); end if;
  perform set_config('tabletap.allocation_scope', '', true);
  perform set_config('tabletap.allocation_scope', to_json(p_orders)::text, true);
  -- Held for the rest of the call, so the choice below and the update after it
  -- see the same orders: a waiter settling one in between waits for this.
  perform 1 from orders where id = any(p_orders) order by id for update;

  select * into v_checkout from diner_checkouts where stripe_payment_intent = p_intent for update;
  if found and not v_checkout.discount_applied and v_checkout.order_discounts <> '{}'::jsonb then
    perform set_config('tabletap.diner_discount', v_checkout.id::text, true);
    for v_discount in select key::uuid id, value::numeric amount from jsonb_each_text(v_checkout.order_discounts) where value::numeric > 0 loop
      -- Food collected in between is no longer this card's debt. Discount
      -- only what is still owed; the unused charge becomes an explicit return.
      select least(v_discount.amount, greatest(o.total - public.retained_order_coverage(o.restaurant_id, o.id)
        - greatest(o.tip - coalesce((select sum(a.tip) from payment_allocations a where a.order_id = o.id), 0), 0), 0))
        into v_off from orders o where o.id = v_discount.id and o.id = any(p_orders)
          and not o.paid and not o.written_off and o.status <> 'cancelled';
      if v_off is null then continue; end if;
      update orders set total = total - v_off, discount = discount + v_off,
        coupon_code = v_checkout.metadata->>'settle_coupon'
       where id = v_discount.id and id = any(p_orders) and not paid and not written_off and status <> 'cancelled';
      v_applied := v_applied + v_off;
    end loop;
    update coupon_redemptions set amount = v_applied where checkout_attempt_id = v_checkout.id;
    perform set_config('tabletap.diner_discount', '', true);
    update diner_checkouts set discount_applied = true where id = v_checkout.id;
  end if;

  -- Which order carries the gratuity: the one asked for if this call settles
  -- it, otherwise the first that it does settle.
  select coalesce(
           (select o.id from orders o where o.id = p_tip_order and o.id = any(p_orders) and o.paid = false),
           (select o.id from orders o where o.id = any(p_orders) and o.paid = false order by o.created_at, o.id limit 1))
    into v_tip_on;

  with settled as (
    update orders
       set paid = true,
           pay_method = 'card',
           status = coalesce(p_status, status),
           stripe_payment_intent = case when p_status is null then stripe_payment_intent else p_intent end
     where id = any(p_orders)
       and paid = false and not written_off and status <> 'cancelled'
    returning id, session_id, total, restaurant_id
  ), written as (
    insert into payments (restaurant_id, order_id, session_id, amount, tip, method, stripe_payment_intent)
    select s.restaurant_id, s.id, s.session_id,
           round(greatest(s.total - public.retained_order_coverage(s.restaurant_id, s.id), 0) + case when s.id = v_tip_on then coalesce(p_tip, 0) else 0 end, 2),
           greatest((select o.tip from orders o where o.id = s.id) - coalesce((select sum(a.tip) from payment_allocations a where a.order_id = s.id), 0), 0)
             + case when s.id = v_tip_on then round(coalesce(p_tip, 0), 2) else 0 end,
           'card', p_intent
      from settled s
     where greatest(s.total - public.retained_order_coverage(s.restaurant_id, s.id), 0) + case when s.id = v_tip_on then coalesce(p_tip, 0) else 0 end > 0
    on conflict do nothing
    returning 1
  )
  select coalesce(array_agg(id), '{}') into v_settled from settled;

  if coalesce(p_tip, 0) > 0 and v_tip_on = any(v_settled) then
    update orders
       set tip = round(coalesce(tip, 0) + p_tip, 2), total = round(total + p_tip, 2)
     where id = v_tip_on;
  end if;

  v_missed := coalesce((select array_agg(o) from unnest(p_orders) o where not (o = any(v_settled))), '{}');

  -- Orders this payment was for that somebody else had settled. Whatever was
  -- charged and is not in the ledger under this payment — a repeat of the
  -- event finds it all there — is money taken twice.
  if coalesce(p_charged, 0) > 0 and p_intent is not null then
    select coalesce(sum(amount), 0) into v_recorded
      from payments where stripe_payment_intent = p_intent and order_id = any(p_orders);
    if v_recorded > round(p_charged, 2) then raise exception 'card receipts exceed verified charge'; end if;
    v_owed := round(p_charged - v_recorded, 2);
    if v_owed > 0 then
      select o.restaurant_id, o.table_label, o.currency into v_rest, v_label, v_currency
        from orders o where o.id = coalesce(v_missed[1], p_orders[1]);
      if v_rest is not null then
        insert into refunds_due (restaurant_id, stripe_payment_intent, amount, order_ids, table_label)
        values (v_rest, p_intent, v_owed, v_missed, v_label)
        on conflict (stripe_payment_intent) do nothing;
        if found then
          insert into notifications (restaurant_id, kind, data)
          values (v_rest, 'refund_due',
                  jsonb_build_object('amount', v_owed, 'currency', v_currency, 'table', v_label));
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'settled', to_jsonb(v_settled),
    'tip_on', v_tip_on,
    'not_settled', to_jsonb(v_missed));
end;
$$;
revoke all on function public.settle_card_orders_v2(uuid[], text, numeric, uuid, text, numeric)
  from public, anon, authenticated;
grant execute on function public.settle_card_orders_v2(uuid[], text, numeric, uuid, text, numeric)
  to service_role;

create or replace function public.settle_split_share_v2(
  p_split  uuid,
  p_share  int,
  p_amount numeric,
  p_tip    numeric,
  p_intent text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant uuid;
  v_session    uuid;
  v_claimed    int;
  v_payment uuid;
  v_existing_tip numeric;
  v_remaining numeric;
begin
  perform public.lock_restaurant_money((select restaurant_id from bill_splits where id = p_split));
  perform set_config('tabletap.allocation_writer', 'v1', true);
  if (select restaurant_id from bill_splits where id = p_split) is not null then perform public.backfill_payment_allocations((select restaurant_id from bill_splits where id = p_split)); end if;
  perform set_config('tabletap.allocation_scope', (select to_jsonb(order_ids)::text from bill_splits where id = p_split), true);
  select restaurant_id, session_id into v_restaurant, v_session from bill_splits where id = p_split;
  if not found then return false; end if;
  if (select status from bill_splits where id = p_split) <> 'locked' then return false; end if;

  perform 1 from orders where id = any((select order_ids from bill_splits where id = p_split)::uuid[]) order by id for update;
  select coalesce(sum(greatest(o.total - public.retained_order_coverage(v_restaurant, o.id), 0)), 0) into v_remaining
    from orders o where o.id = any((select order_ids from bill_splits where id = p_split)::uuid[])
      and not o.paid and not o.written_off and o.account_id is null and o.status not in ('cancelled', 'pending_payment');
  if p_amount > v_remaining or p_amount is distinct from
    (select amount from bill_split_claims where split_id = p_split and share_no = p_share) then return false; end if;

  update bill_split_claims set paid_at = now()
   where split_id = p_split and share_no = p_share and paid_at is null;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then return false; end if;

  select coalesce(sum(greatest(o.total - coalesce(a.amount, 0), 0)), 0),
    coalesce(sum(greatest(o.tip - coalesce(a.tip, 0), 0)), 0) into v_remaining, v_existing_tip
    from orders o left join lateral(select sum(amount) amount, sum(tip) tip from payment_allocations where order_id = o.id) a on true
    where o.id = any((select order_ids from bill_splits where id = p_split)::uuid[]);
  v_existing_tip := least(v_remaining, v_existing_tip);
  v_existing_tip := case when v_remaining <= 0 then 0
    else least(v_existing_tip, round(p_amount * v_existing_tip / v_remaining, 2)) end;
  insert into payments (restaurant_id, session_id, amount, tip, method, stripe_payment_intent)
  values (v_restaurant, v_session, round(p_amount + coalesce(p_tip, 0), 2),
          round(coalesce(p_tip, 0) + v_existing_tip, 2), 'card', p_intent) returning id into v_payment;
  update bill_split_claims set payment_id = v_payment where split_id = p_split and share_no = p_share;

  -- `total` and `tip` rise together, so a running balance still reads the
  -- same food as owed — the way settling a whole table and collecting in
  -- parts both attribute a gratuity.
  if coalesce(p_tip, 0) > 0 then
    update orders
       set tip = round(coalesce(tip, 0) + p_tip, 2), total = round(total + p_tip, 2)
     where id = (
       select id from orders
        where id = any((select order_ids from bill_splits where id = p_split)::uuid[])
          and not paid and account_id is null and status <> 'cancelled' and status <> 'pending_payment' and written_off = false
        order by created_at asc limit 1);
  end if;
  return true;
end;
$$;
revoke all on function public.settle_split_share_v2(uuid, int, numeric, numeric, text)
  from public, anon, authenticated;
grant execute on function public.settle_split_share_v2(uuid, int, numeric, numeric, text)
  to service_role;

create or replace function public.settle_sale_v2(
  p_restaurant uuid,
  p_order      uuid,
  p_method     text,
  p_actor      text,
  p_status     text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric;
begin
  perform public.lock_restaurant_money(p_restaurant);
  perform set_config('tabletap.allocation_writer', 'v1', true);
  if p_restaurant is not null then perform public.backfill_payment_allocations(p_restaurant); end if;
  perform set_config('tabletap.allocation_scope', '', true);
  perform set_config('tabletap.allocation_scope', to_json(array[p_order])::text, true);
  if p_method not in ('cash', 'card') then
    raise exception 'settle_sale: unknown method %', p_method;
  end if;
  if p_status not in ('received', 'completed') then
    raise exception 'settle_sale: a sale cannot be %', p_status;
  end if;

  update orders
     set paid = true, pay_method = p_method, status = p_status
   where id = p_order
     and restaurant_id = p_restaurant
     and paid = false
     and status = 'pending_payment'
  returning total into v_total;
  if not found then
    raise exception 'not_owed';
  end if;

  if v_total > 0 then
    insert into payments (restaurant_id, order_id, amount, method, actor_email)
    values (p_restaurant, p_order, round(v_total, 2), p_method, p_actor);
  end if;
  return true;
end;
$$;
revoke all on function public.settle_sale_v2(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.settle_sale_v2(uuid, uuid, text, text, text)
  to service_role;

create or replace function public.account_charge_v2(
  p_restaurant uuid,
  p_account    uuid,
  p_orders     uuid[],
  p_expected   numeric,
  p_actor      text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_account  customer_accounts;
  v_count    int;
  v_amount   numeric;
  v_sessions uuid[];
  v_owed     numeric;
  v_currency text;
begin
  perform public.lock_restaurant_money(p_restaurant);
  perform set_config('tabletap.allocation_writer', 'v1', true);
  if p_restaurant is not null then perform public.backfill_payment_allocations(p_restaurant); end if;
  perform set_config('tabletap.allocation_scope', '', true);
  select * into v_account from customer_accounts
   where id = p_account and restaurant_id = p_restaurant for update;
  if v_account.id is null or v_account.status <> 'open' then
    return jsonb_build_object('outcome', 'closed');
  end if;
  if p_orders is null or cardinality(p_orders) = 0 then
    return jsonb_build_object('outcome', 'stale');
  end if;

  perform 1 from orders where id = any(p_orders) order by id for update;

  -- A card checkout open on any of them: the diner is paying it right now.
  if exists (select 1 from orders where id = any(p_orders)
              and card_checkout_at is not null and card_checkout_at > now() - interval '35 minutes'
              and paid = false) then
    return jsonb_build_object('outcome', 'paying');
  end if;

  select count(*), coalesce(sum(total), 0),
         array_agg(distinct session_id) filter (where session_id is not null)
    into v_count, v_amount, v_sessions
    from orders
   where id = any(p_orders)
     and restaurant_id = p_restaurant
     and paid = false and written_off = false and account_id is null
     and status not in ('cancelled', 'pending_payment');
  if v_count <> cardinality(p_orders) or abs(v_amount - p_expected) > 0.005 then
    return jsonb_build_object('outcome', 'stale');
  end if;

  -- Part of the table's bill already collected, or a division under way: the
  -- orders cannot move whole, and the account would owe what was paid.
  if exists (select 1 from payments where session_id = any(coalesce(v_sessions, '{}')) and order_id is null)
     or exists (select 1 from bill_splits where session_id = any(coalesce(v_sessions, '{}'))
                 and status in ('proposed', 'locked')) then
    return jsonb_build_object('outcome', 'partly_paid');
  end if;

  -- A credit ceiling has no exchange rate. Keep new debt in the existing
  -- currency; older mixed accounts can still collect each currency separately.
  select min(currency) into v_currency from orders where id = any(p_orders) and restaurant_id = p_restaurant;
  if exists(select 1 from orders where id = any(p_orders) and currency <> v_currency)
    or exists(select 1 from orders where account_id = p_account and not paid and not written_off
      and status <> 'cancelled' and currency <> v_currency) then
    return jsonb_build_object('outcome','mixed_currency');
  end if;
  v_owed := public.account_owed(p_account);
  if v_owed + v_amount > v_account.credit_limit then
    return jsonb_build_object('outcome', 'limit', 'owed', v_owed, 'limit', v_account.credit_limit, 'currency', v_currency);
  end if;

  update orders set account_id = p_account, charged_by = p_actor, charged_at = now()
   where id = any(p_orders);
  perform public.close_session_if_clear(s, 'account') from unnest(coalesce(v_sessions, '{}')) s;

  return jsonb_build_object('outcome', 'charged', 'amount', v_amount, 'owed', v_owed + v_amount);
end;
$$;
revoke all on function public.account_charge_v2(uuid, uuid, uuid[], numeric, text) from public, anon, authenticated;
grant execute on function public.account_charge_v2(uuid, uuid, uuid[], numeric, text) to service_role;

create or replace function public.account_change_v2(
  p_restaurant uuid, p_account uuid, p_action text, p_limit numeric, p_actor text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_account customer_accounts;
  v_owed numeric;
begin
  perform public.lock_restaurant_money(p_restaurant);
  perform set_config('tabletap.allocation_writer', 'v1', true);
  if p_restaurant is not null then perform public.backfill_payment_allocations(p_restaurant); end if;
  perform set_config('tabletap.allocation_scope', '', true);
  select * into v_account from customer_accounts
   where id = p_account and restaurant_id = p_restaurant for update;
  if v_account.id is null then return jsonb_build_object('outcome', 'missing'); end if;
  v_owed := public.account_owed(p_account);
  if p_action = 'limit' then
    if p_limit is null or p_limit <= 0 or p_limit > 1000000 then
      return jsonb_build_object('outcome', 'invalid');
    end if;
    if p_limit < v_owed then return jsonb_build_object('outcome', 'limit', 'owed', v_owed); end if;
    update customer_accounts set credit_limit = p_limit where id = p_account;
  elsif p_action = 'close' then
    if v_owed > 0 then return jsonb_build_object('outcome', 'owes', 'owed', v_owed); end if;
    update customer_accounts set status = 'closed', closed_by = p_actor, closed_at = now() where id = p_account;
  else
    return jsonb_build_object('outcome', 'invalid');
  end if;
  return jsonb_build_object('outcome', 'changed', 'previous_limit', v_account.credit_limit);
end;
$$;
revoke all on function public.account_change_v2(uuid, uuid, text, numeric, text) from public, anon, authenticated;
grant execute on function public.account_change_v2(uuid, uuid, text, numeric, text) to service_role;

create or replace function public.account_settle_v2(
  p_restaurant uuid,
  p_account    uuid,
  p_expected   numeric,
  p_tip        numeric,
  p_method     text,
  p_actor      text,
  p_ref        text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_account customer_accounts;
  v_ids     uuid[];
  v_owed    numeric;
  v_tip     numeric := greatest(coalesce(p_tip, 0), 0);
begin
  perform public.lock_restaurant_money(p_restaurant);
  perform set_config('tabletap.allocation_writer', 'v1', true);
  if p_restaurant is not null then perform public.backfill_payment_allocations(p_restaurant); end if;
  perform set_config('tabletap.allocation_scope', '', true);
  select * into v_account from customer_accounts
   where id = p_account and restaurant_id = p_restaurant for update;
  if v_account.id is null then return jsonb_build_object('outcome', 'missing'); end if;
  if p_ref is not null and exists (select 1 from payments
                                    where restaurant_id = p_restaurant and client_ref = p_ref) then
    return jsonb_build_object('outcome', 'duplicate');
  end if;
  if v_account.checkout_until is not null and v_account.checkout_until > now() then
    return jsonb_build_object('outcome', 'paying');
  end if;

  perform 1 from orders where account_id = p_account and paid = false and written_off = false and status <> 'cancelled' order by id for update;
  select coalesce(sum(total), 0), array_agg(id order by created_at desc)
    into v_owed, v_ids
    from orders where account_id = p_account and paid = false and written_off = false and status <> 'cancelled';
  if v_owed <= 0 then return jsonb_build_object('outcome', 'nothing'); end if;
  if abs(v_owed - p_expected) > 0.005 then
    return jsonb_build_object('outcome', 'changed', 'owed', v_owed);
  end if;
  -- A gratuity is never more than what it thanks somebody for.
  v_tip := least(v_tip, v_owed);

  insert into payments (restaurant_id, account_id, amount, tip, method, actor_email, client_ref)
  values (p_restaurant, p_account, v_owed + v_tip,
    v_tip + (select coalesce(sum(tip), 0) from orders where id = any(v_ids) and written_off = false), p_method, p_actor, p_ref);
  update orders set paid = true, pay_method = p_method where id = any(v_ids);
  -- The gratuity lands on the latest order, as a table's does on its first.
  if v_tip > 0 then
    update orders set tip = tip + v_tip, total = total + v_tip where id = v_ids[1];
  end if;
  return jsonb_build_object('outcome', 'paid', 'amount', v_owed + v_tip, 'tip', v_tip);
end;
$$;
revoke all on function public.account_settle_v2(uuid, uuid, numeric, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.account_settle_v2(uuid, uuid, numeric, numeric, text, text, text) to service_role;

create or replace function public.account_checkout_open_v2(
  p_restaurant uuid,
  p_account    uuid,
  p_expected   numeric,
  p_tip        numeric,
  p_fee        numeric
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_account customer_accounts;
  v_ids     uuid[];
  v_owed    numeric;
  v_tip     numeric := greatest(coalesce(p_tip, 0), 0);
  v_id      uuid;
begin
  perform public.lock_restaurant_money(p_restaurant);
  perform set_config('tabletap.allocation_writer', 'v1', true);
  if p_restaurant is not null then perform public.backfill_payment_allocations(p_restaurant); end if;
  select * into v_account from customer_accounts
   where id = p_account and restaurant_id = p_restaurant for update;
  if v_account.id is null then return jsonb_build_object('outcome', 'missing'); end if;
  if v_account.checkout_until is not null and v_account.checkout_until > now() then
    return jsonb_build_object('outcome', 'paying');
  end if;
  perform 1 from orders where account_id = p_account and paid = false
    and written_off = false and status <> 'cancelled' order by id for update;
  select coalesce(sum(total), 0), array_agg(id order by created_at desc)
    into v_owed, v_ids
    from orders where account_id = p_account and paid = false and written_off = false and status <> 'cancelled';
  if v_owed <= 0 then return jsonb_build_object('outcome', 'nothing'); end if;
  if abs(v_owed - p_expected) > 0.005 then
    return jsonb_build_object('outcome', 'changed', 'owed', v_owed);
  end if;
  -- A checkout still open once its hold has lapsed is dead: its Stripe session
  -- expired at thirty minutes, five before the hold. Closed here, so its
  -- expiry arriving late (Stripe retries for days) finds nothing to release.
  -- Releasing it lifted the hold of the checkout opened now, and the till
  -- could collect the account while the customer was paying it by card.
  update account_checkouts set status = 'expired' where account_id = p_account and status = 'open';
  v_tip := least(v_tip, v_owed);
  insert into account_checkouts (restaurant_id, account_id, order_ids, amount, tip, fee)
  values (p_restaurant, p_account, v_ids, v_owed, v_tip, greatest(coalesce(p_fee, 0), 0)) returning id into v_id;
  update customer_accounts set checkout_until = now() + interval '35 minutes', checkout_id = v_id where id = p_account;
  return jsonb_build_object('outcome', 'open', 'checkout', v_id, 'amount', v_owed, 'tip', v_tip);
end;
$$;
revoke all on function public.account_checkout_open_v2(uuid, uuid, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.account_checkout_open_v2(uuid, uuid, numeric, numeric, numeric) to service_role;

create or replace function public.account_checkout_settle_v2(
  p_checkout uuid,
  p_intent   text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_checkout account_checkouts;
  v_account  customer_accounts;
  v_ids      uuid[];
  v_still    numeric;
  v_food     numeric;
  v_tip      numeric;
  v_twice    numeric;
begin
  perform public.lock_restaurant_money((select restaurant_id from account_checkouts where id = p_checkout));
  perform set_config('tabletap.allocation_writer', 'v1', true);
  if (select restaurant_id from account_checkouts where id = p_checkout) is not null then perform public.backfill_payment_allocations((select restaurant_id from account_checkouts where id = p_checkout)); end if;
  perform set_config('tabletap.allocation_scope', '', true);
  select * into v_checkout from account_checkouts where id = p_checkout;
  if v_checkout.id is null then return jsonb_build_object('outcome', 'missing'); end if;
  -- Opening the next checkout holds the account first too.
  select * into v_account from customer_accounts where id = v_checkout.account_id for update;
  select * into v_checkout from account_checkouts where id = p_checkout for update;
  if v_checkout.status = 'paid' then return jsonb_build_object('outcome', 'duplicate'); end if;

  -- Freeze each order before summing it: a cancel or discount must not commit
  -- between the amount read and the paid flag written below.
  perform 1 from orders where id = any(v_checkout.order_ids)
    and paid = false and written_off = false and status <> 'cancelled' order by id for update;

  -- The ones still owed. The hold keeps the till off them while the customer
  -- is on Stripe's page, but a payment whose webhook arrives after the hold
  -- ran out can find the till collected some or all of them meanwhile.
  select array_agg(id order by created_at desc), coalesce(sum(total), 0) into v_ids, v_still
    from orders where id = any(v_checkout.order_ids) and paid = false and written_off = false and status <> 'cancelled';
  v_food := least(v_checkout.amount, v_still);
  v_tip := case when v_ids is null then 0 else v_checkout.tip end;
  perform set_config('tabletap.allocation_scope', to_json(coalesce(v_ids, '{}'::uuid[]))::text, true);
  if v_food + v_tip > 0 then
    insert into payments (restaurant_id, account_id, amount, tip, method, stripe_payment_intent)
    values (v_checkout.restaurant_id, v_checkout.account_id, v_food + v_tip,
      v_tip + (select coalesce(sum(tip), 0) from orders where id = any(v_ids) and written_off = false), 'card', p_intent);
  end if;
  -- What the card paid for food already paid another way is the customer's
  -- money taken twice: kept as a refund due, out of the ledger, and the bell
  -- says so — the same as a card payment landing on a table already settled.
  v_twice := round(v_checkout.amount + v_checkout.tip - v_food - v_tip, 2);
  if v_twice > 0 and p_intent is not null then
    insert into refunds_due (restaurant_id, stripe_payment_intent, amount, order_ids, account_name)
    values (v_checkout.restaurant_id, p_intent, v_twice, v_checkout.order_ids, v_account.name)
    on conflict (stripe_payment_intent) do nothing;
    if found then
      insert into notifications (restaurant_id, kind, data)
      values (v_checkout.restaurant_id, 'refund_due',
              jsonb_build_object('amount', v_twice, 'currency', (select currency from restaurants where id = v_checkout.restaurant_id),
                                 'account', v_account.name));
    end if;
  end if;
  update orders set paid = true, pay_method = 'card' where id = any(coalesce(v_ids, '{}'));
  if v_checkout.tip > 0 and v_ids is not null then
    update orders set tip = tip + v_checkout.tip, total = total + v_checkout.tip where id = v_ids[1];
  end if;
  -- Our fee is taken in `platform_fees` by the webhook; `orders.platform_fee`
  -- is the frozen record of fees from before that ledger.
  update account_checkouts set status = 'paid' where id = p_checkout;
  update customer_accounts set checkout_until = null, checkout_id = null
   where id = v_checkout.account_id and checkout_id = p_checkout;
  return jsonb_build_object('outcome', 'paid', 'orders', coalesce(cardinality(v_ids), 0));
end;
$$;
revoke all on function public.account_checkout_settle_v2(uuid, text) from public, anon, authenticated;
grant execute on function public.account_checkout_settle_v2(uuid, text) to service_role;

create or replace function public.settle_offline_sale_v2(
  p_restaurant uuid, p_order uuid, p_method text, p_actor text, p_at timestamptz
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_total numeric;
begin
  perform public.lock_restaurant_money(p_restaurant);
  perform set_config('tabletap.allocation_writer', 'v1', true);
  if p_restaurant is not null then perform public.backfill_payment_allocations(p_restaurant); end if;
  perform set_config('tabletap.allocation_scope', '', true);
  perform set_config('tabletap.allocation_scope', to_json(array[p_order])::text, true);
  if p_method not in ('cash', 'card') then
    raise exception 'settle_offline_sale: unknown method %', p_method;
  end if;
  update orders
     set paid = true, pay_method = p_method, status = 'completed'
   where id = p_order and restaurant_id = p_restaurant and paid = false and status = 'pending_payment'
  returning total into v_total;
  if not found then
    raise exception 'not_owed';
  end if;
  if v_total > 0 then
    insert into payments (restaurant_id, order_id, amount, method, actor_email, created_at)
    values (p_restaurant, p_order, round(v_total, 2), p_method, p_actor, p_at);
  end if;
  return true;
end;
$$;
revoke all on function public.settle_offline_sale_v2(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.settle_offline_sale_v2(uuid, uuid, text, text, timestamptz) to service_role;

create or replace function public.cancel_order_v2(
  p_restaurant uuid, p_order uuid, p_refund text, p_legacy_demand jsonb,
  p_expected_paid boolean, p_expected_account uuid, p_expected_hold timestamptz, p_expected_checkout uuid
) returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_order orders%rowtype;
  v_account customer_accounts;
begin
  perform public.lock_restaurant_money(p_restaurant);
  perform set_config('tabletap.allocation_writer', 'v1', true);
  if p_restaurant is not null then perform public.backfill_payment_allocations(p_restaurant); end if;
  perform set_config('tabletap.allocation_scope', '', true);
  -- Collection holds the account first. Recheck the plan under that lock so
  -- an unpaid cancel cannot silently erase food that was just collected.
  if p_expected_account is not null then
    select * into v_account from customer_accounts
     where id = p_expected_account and restaurant_id = p_restaurant for update;
    if v_account.id is null or v_account.checkout_until is distinct from p_expected_hold
       or v_account.checkout_id is distinct from p_expected_checkout then
      return false;
    end if;
    if not p_expected_paid and v_account.checkout_until > now() then return false; end if;
  end if;
  select * into v_order from orders where id = p_order and restaurant_id = p_restaurant for update;
  if v_order.id is null or v_order.paid is distinct from p_expected_paid
     or v_order.account_id is distinct from p_expected_account then return false; end if;
  update orders set status = 'cancelled', stripe_refund_id = p_refund, cancelled_at = now()
    where id = p_order and restaurant_id = p_restaurant and status in ('received', 'preparing')
    returning * into v_order;
  if not found then return false; end if;
  -- The order trigger returns proven reservations and logs unknown legacy stock.
  return true;
end;
$$;
revoke all on function public.cancel_order_v2(uuid, uuid, text, jsonb, boolean, uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.cancel_order_v2(uuid, uuid, text, jsonb, boolean, uuid, timestamptz, uuid) to service_role;

create or replace function public.ring_pos_sale_v2(
  p_restaurant uuid, p_ref uuid, p_order jsonb, p_method text, p_actor text,
  p_status text, p_at timestamptz, p_terminal text, p_demand jsonb,
  p_inventory boolean, p_threshold int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ticket jsonb;
  v_stock jsonb := '{"ok":true,"low":[]}'::jsonb;
  v_reservation uuid;
begin
  perform public.lock_restaurant_money(p_restaurant);
  perform set_config('tabletap.allocation_writer', 'v1', true);
  if p_restaurant is not null then perform public.backfill_payment_allocations(p_restaurant); end if;
  perform set_config('tabletap.allocation_scope', '', true);
  if p_method not in ('cash', 'card') or p_status not in ('received', 'completed') then
    raise exception 'Invalid till sale';
  end if;
  v_ticket := public.pos_ticket(p_restaurant, p_ref);
  if v_ticket is not null then return v_ticket; end if;
  if p_at is not null then
    -- It already happened, so the count floors at zero rather than refusing.
    -- In the same transaction as the money: a sale recorded without its stock
    -- was acknowledged, and nothing ever moved the count again. The floor
    -- skips dishes that are gone and cannot run short, so what can fail here
    -- is a lock that timed out, which the device's next send retries whole.
    perform public.take_stock_floor(p_restaurant, p_demand);
  elsif p_inventory then
    v_reservation := p_ref;
    v_stock := public.reserve_stock(p_restaurant, p_demand, p_threshold, v_reservation);
    if not (v_stock->>'ok')::boolean then
      return v_stock || jsonb_build_object('outcome', 'stock');
    end if;
  end if;
  perform public.pos_insert_order(p_restaurant, p_ref, p_order, 'pending_payment', p_at, v_reservation);
  if p_at is not null then
    perform public.settle_offline_sale_v2(p_restaurant, p_ref, p_method, p_actor, p_at);
  else
    perform public.settle_sale_v2(p_restaurant, p_ref, p_method, p_actor, p_status);
  end if;
  if p_method = 'card' and p_terminal is not null then
    update payments set terminal_ref = p_terminal
     where restaurant_id = p_restaurant and order_id = p_ref and method = 'card';
  end if;
  return jsonb_build_object('outcome', 'settled', 'settled', true, 'orderId', p_ref,
    'total', (p_order->>'total')::numeric, 'low', v_stock->'low',
    'handedOver', p_at is not null or p_status = 'completed');
end;
$$;
revoke all on function public.ring_pos_sale_v2(uuid, uuid, jsonb, text, text, text, timestamptz, text, jsonb, boolean, int) from public, anon, authenticated;
grant execute on function public.ring_pos_sale_v2(uuid, uuid, jsonb, text, text, text, timestamptz, text, jsonb, boolean, int) to service_role;

create or replace function public.ring_pos_account_v2(
  p_restaurant uuid, p_ref uuid, p_order jsonb, p_account uuid, p_actor text,
  p_status text, p_demand jsonb, p_inventory boolean, p_threshold int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ticket jsonb;
  v_charge jsonb;
  v_stock jsonb := '{"ok":true,"low":[]}'::jsonb;
  v_reservation uuid;
  v_name text;
  o orders;
begin
  perform public.lock_restaurant_money(p_restaurant);
  perform set_config('tabletap.allocation_writer', 'v1', true);
  if p_restaurant is not null then perform public.backfill_payment_allocations(p_restaurant); end if;
  perform set_config('tabletap.allocation_scope', '', true);
  if p_status not in ('received', 'completed') then raise exception 'Invalid till status'; end if;
  v_ticket := public.pos_ticket(p_restaurant, p_ref);
  if v_ticket is not null then
    select * into o from orders where restaurant_id = p_restaurant and pos_ref = p_ref;
    -- A sale rung before its request was saved has no scope. It is matched
    -- on its account, as it always was: the clients in production forget a
    -- reference on a 409, so refusing its retry rang it a second time.
    if o.account_id is distinct from p_account
      or (o.request_scope is not null and o.request_scope is distinct from p_order->>'request_scope') then
      return jsonb_build_object('outcome', 'conflict');
    end if;
    return v_ticket;
  end if;
  -- Lock the account before stock, as every credit decision must see its latest debt.
  select name into v_name from customer_accounts
   where id = p_account and restaurant_id = p_restaurant for update;
  if not found then return jsonb_build_object('outcome', 'closed'); end if;
  begin
    if p_inventory then
      v_reservation := p_ref;
      v_stock := public.reserve_stock(p_restaurant, p_demand, p_threshold, v_reservation);
      if not (v_stock->>'ok')::boolean then
        return v_stock || jsonb_build_object('outcome', 'stock');
      end if;
    end if;
    perform public.pos_insert_order(p_restaurant, p_ref, p_order, p_status, null, v_reservation);
    update orders set request_scope = p_order->>'request_scope' where restaurant_id = p_restaurant and pos_ref = p_ref;
    v_charge := public.account_charge_v2(p_restaurant, p_account, array[p_ref], (p_order->>'total')::numeric, p_actor);
    if v_charge->>'outcome' <> 'charged' then
      raise exception using errcode = 'PT001', message = 'Account refused the sale';
    end if;
  exception when sqlstate 'PT001' then
    return v_charge;
  end;
  return jsonb_build_object('outcome', 'settled', 'settled', true, 'orderId', p_ref,
    'total', (p_order->>'total')::numeric, 'low', v_stock->'low', 'handedOver', p_status = 'completed',
    'onAccount', jsonb_build_object('name', v_name, 'owed', v_charge->'owed'));
end;
$$;
revoke all on function public.ring_pos_account_v2(uuid, uuid, jsonb, uuid, text, text, jsonb, boolean, int) from public, anon, authenticated;
grant execute on function public.ring_pos_account_v2(uuid, uuid, jsonb, uuid, text, text, jsonb, boolean, int) to service_role;

create or replace function public.approve_write_off_request_v2(
  p_request uuid, p_restaurant uuid, p_actor text, p_amount numeric, p_note text
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_request write_off_requests%rowtype;
  v_count int;
  v_total numeric;
begin
  perform public.lock_restaurant_money(p_restaurant);
  perform set_config('tabletap.allocation_writer', 'v1', true);
  if p_restaurant is not null then perform public.backfill_payment_allocations(p_restaurant); end if;
  perform set_config('tabletap.allocation_scope', '', true);
  select * into v_request from write_off_requests
   where id = p_request and restaurant_id = p_restaurant for update;
  if not found or v_request.status <> 'pending' then return 'gone'; end if;
  if p_amount is null or p_amount <= 0 or v_request.amount <> p_amount then return 'changed'; end if;
  perform 1 from orders where id = any(v_request.order_ids) and restaurant_id = p_restaurant
   order by id for update;
  select count(*), coalesce(sum(total), 0) into v_count, v_total from orders
   where id = any(v_request.order_ids) and restaurant_id = p_restaurant
     and paid = false and written_off = false and status not in ('cancelled', 'pending_payment')
     -- An order moved onto a customer account is the account's debt now.
     and account_id is null;
  if v_count <> cardinality(v_request.order_ids) or round(v_total, 2) <> p_amount then return 'changed'; end if;

  update orders set written_off = true, write_off_reason = v_request.reason,
    write_off_note = v_request.note, written_off_by = p_actor, written_off_at = now(), status = 'completed'
   where id = any(v_request.order_ids) and restaurant_id = p_restaurant
     and paid = false and written_off = false and status not in ('cancelled', 'pending_payment')
     and account_id is null;
  update write_off_requests set status = 'approved', decided_by = p_actor, decided_at = now(), decided_note = p_note
   where id = p_request and restaurant_id = p_restaurant and status = 'pending';
  return 'approved';
end; $$;
revoke all on function public.approve_write_off_request_v2(uuid, uuid, text, numeric, text) from public, anon, authenticated;
grant execute on function public.approve_write_off_request_v2(uuid, uuid, text, numeric, text) to service_role;

create or replace function public.approve_discount_request_v2(
  p_request uuid, p_restaurant uuid, p_actor text, p_amount numeric
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_request discount_requests%rowtype;
  v_coupon coupons%rowtype;
  v_count int;
  v_total numeric;
  v_amount numeric;
begin
  perform public.lock_restaurant_money(p_restaurant);
  perform set_config('tabletap.allocation_writer', 'v1', true);
  if p_restaurant is not null then perform public.backfill_payment_allocations(p_restaurant); end if;
  perform set_config('tabletap.allocation_scope', '', true);
  select * into v_request from discount_requests
   where id = p_request and restaurant_id = p_restaurant for update;
  if not found or v_request.status <> 'pending' then return 'gone'; end if;
  if p_amount is null or p_amount <= 0 or v_request.amount <> p_amount then return 'changed'; end if;
  perform 1 from orders where id = any(v_request.order_ids) and restaurant_id = p_restaurant
   order by id for update;
  select count(*), coalesce(sum(total), 0) into v_count, v_total from orders
   where id = any(v_request.order_ids) and restaurant_id = p_restaurant
     and paid = false and written_off = false and status not in ('cancelled', 'pending_payment')
     and coupon_code is null and account_id is null;
  if v_count <> cardinality(v_request.order_ids) or v_total <= 0 then return 'changed'; end if;
  select * into v_coupon from coupons
   where restaurant_id = p_restaurant and upper(code) = upper(v_request.code) for update;
  if not found or not v_coupon.active
     or v_coupon.starts_at > now() or v_coupon.ends_at <= now()
     or v_total < v_coupon.min_subtotal
     or v_coupon.uses_count >= v_coupon.max_uses then return 'changed'; end if;
  v_amount := greatest(0, least(v_total, round(case when v_coupon.kind = 'percent'
    then v_total * v_coupon.value / 100 else v_coupon.value end, 2)));
  if v_amount <> p_amount then return 'changed'; end if;
  if redeem_coupon(v_coupon.id) is null then return 'changed'; end if;

  -- Keep the rounding remainder on the largest order, as spreadDiscount does.
  with shares as (
    select id, total, round(p_amount * total / v_total, 2) amount,
      row_number() over (order by total desc, id) position
    from orders where id = any(v_request.order_ids) and restaurant_id = p_restaurant
     and account_id is null
  ), amounts as (
    select id, greatest(0, least(total, amount + case when position = 1
      then p_amount - sum(amount) over () else 0 end)) amount from shares
  )
  update orders o set coupon_code = v_coupon.code,
    discount = round(coalesce(o.discount, 0) + a.amount, 2), total = round(o.total - a.amount, 2)
    from amounts a where o.id = a.id and o.restaurant_id = p_restaurant;
  insert into coupon_redemptions (restaurant_id, coupon_id, order_id, code, amount, confirmed_at)
  values (p_restaurant, v_coupon.id, v_request.order_ids[1], v_coupon.code, p_amount, now());
  update discount_requests set status = 'approved', decided_by = p_actor, decided_at = now()
   where id = p_request and restaurant_id = p_restaurant and status = 'pending';
  return 'approved';
end; $$;
revoke all on function public.approve_discount_request_v2(uuid, uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.approve_discount_request_v2(uuid, uuid, text, numeric) to service_role;

-- Duplicate charges need the same durable retry rule as order cancellations.
-- Unknown/pending outcomes reuse their immutable request; only a confirmed
-- terminal failure can advance to a new Stripe idempotency key.
create unique index if not exists refunds_due_tenant_identity on refunds_due(restaurant_id, id);
create table if not exists refund_due_attempts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  due_id uuid not null,
  foreign key (restaurant_id, due_id) references refunds_due(restaurant_id, id) on delete cascade,
  attempt_no int not null check (attempt_no > 0),
  idempotency_key text not null unique,
  amount numeric not null check (amount > 0 and amount = round(amount, 2)),
  stripe_account_id text not null,
  stripe_payment_intent text not null,
  stripe_refund_id text,
  provider_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(due_id, attempt_no)
);
alter table refund_due_attempts enable row level security;
revoke all on refund_due_attempts from anon, authenticated;
revoke all on refund_due_attempts from public;
grant select, insert, update, delete on refund_due_attempts to service_role;

-- Customer completion and our fee completion are separate facts. A failed fee
-- lookup must remain recoverable even after the diner's money is back.
alter table refunds_due add column if not exists fee_reconciled_at timestamptz;
alter table refunds_due add column if not exists fee_request jsonb;
alter table refunds_due add column if not exists fee_verification_pending boolean not null default true;
alter table refunds_due add column if not exists fee_target_cents int check (fee_target_cents >= 0);
alter table refunds_due add column if not exists fee_request_history jsonb not null default '[]';
alter table refunds_due add column if not exists currency text check (currency ~ '^[A-Z]{3}$');
alter table refunds_due add column if not exists stripe_account_id text;

-- The verified checkout exists before settlement inserts an obligation. Use
-- its frozen currency/account, never today's menu or the order's display price.
create or replace function public.stamp_refund_due_charge()
returns trigger language plpgsql security definer set search_path = public as $$
declare c diner_checkouts;
begin
  select * into c from diner_checkouts
    where restaurant_id = new.restaurant_id and stripe_payment_intent = new.stripe_payment_intent;
  if c.id is not null then
    new.currency := c.currency;
    new.stripe_account_id := c.stripe_account_id;
  end if;
  return new;
end;
$$;
revoke all on function public.stamp_refund_due_charge() from public, anon, authenticated;
grant execute on function public.stamp_refund_due_charge() to service_role;
drop trigger if exists refund_due_charge on refunds_due;
create trigger refund_due_charge before insert on refunds_due
  for each row execute function public.stamp_refund_due_charge();

-- Older rows with no charge evidence stay unverified. Do not infer currency
-- from the restaurant, its orders, or a notification written from menu settings.
update refunds_due d set currency = c.currency, stripe_account_id = coalesce(d.stripe_account_id, c.stripe_account_id)
  from diner_checkouts c where d.restaurant_id = c.restaurant_id
    and d.stripe_payment_intent = c.stripe_payment_intent and d.currency is null;

create or replace function public.start_refund_due_attempt(p_restaurant uuid, p_due uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d refunds_due; a refund_due_attempts; v_account text; v_no int;
begin
  perform public.lock_restaurant_money(p_restaurant);
  select * into d from refunds_due where id = p_due and restaurant_id = p_restaurant for update;
  if d.id is null then return null; end if;
  select * into a from refund_due_attempts where due_id = d.id order by attempt_no desc limit 1;
  if a.id is null or (d.refunded_at is null and a.provider_status in ('failed', 'canceled')) then
    v_no := coalesce(a.attempt_no, 0) + 1;
    v_account := coalesce(a.stripe_account_id, d.stripe_account_id);
    if v_account is null then select stripe_account_id into v_account from restaurants where id = p_restaurant; end if;
    if v_account is null then return null; end if;
    insert into refund_due_attempts(restaurant_id, due_id, attempt_no, idempotency_key, amount, stripe_account_id, stripe_payment_intent, stripe_refund_id, provider_status)
      values(p_restaurant, d.id, v_no, 'refund-due-' || d.id || case when v_no = 1 then '' else '-' || v_no end,
        coalesce(a.amount, d.amount), v_account, coalesce(a.stripe_payment_intent, d.stripe_payment_intent),
        d.stripe_refund_id, case when d.refunded_at is not null then 'succeeded' end) returning * into a;
  end if;
  update refunds_due set stripe_account_id = a.stripe_account_id where id = d.id and stripe_account_id is null;
  return to_jsonb(a);
end;
$$;
revoke all on function public.start_refund_due_attempt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.start_refund_due_attempt(uuid, uuid) to service_role;

-- Persist the exact fee request before calling Stripe. Concurrent retries and
-- a lost response must reuse its amount even if another refund changes the fee.
create or replace function public.start_refund_due_fee(p_restaurant uuid, p_due uuid, p_fee text, p_amount int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d refunds_due;
begin
  perform public.lock_restaurant_money(p_restaurant);
  select * into d from refunds_due where restaurant_id = p_restaurant and id = p_due for update;
  if d.id is null or d.refunded_at is null then return null; end if;
  if d.fee_request is not null then return d.fee_request; end if;
  if p_fee is null or p_amount is null or p_amount <= 0 then raise exception 'invalid fee return'; end if;
  update refunds_due set fee_request = jsonb_build_object('fee_id', p_fee, 'amount', p_amount)
    where id = d.id returning fee_request into d.fee_request;
  return d.fee_request;
end;
$$;
revoke all on function public.start_refund_due_fee(uuid, uuid, text, int) from public, anon, authenticated;
grant execute on function public.start_refund_due_fee(uuid, uuid, text, int) to service_role;

-- Retire only the request whose outcome was checked. An old 300-cent request
-- cannot still land once only 200 cents of the WHOLE fee remain at Stripe.
-- A partial target alone does not prove that; an unknown request stays put.
create or replace function public.advance_refund_due_fee(
  p_restaurant uuid, p_due uuid, p_previous jsonb, p_target int, p_returned int, p_fee_total int, p_refund text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare d refunds_due; v_no int;
begin
  perform public.lock_restaurant_money(p_restaurant);
  select * into d from refunds_due where restaurant_id = p_restaurant and id = p_due for update;
  if d.id is null or d.refunded_at is null or d.fee_request is null then return null; end if;
  if d.fee_request is distinct from p_previous then return null; end if;
  if p_target is null or p_returned is null or p_fee_total is null or p_target <= p_returned
    or p_returned < 0 or p_target > p_fee_total then raise exception 'invalid fee remainder'; end if;
  if p_refund is null and (d.fee_request->>'amount')::int <= p_fee_total - p_returned then return null; end if;
  if p_refund is not null and (d.fee_request->>'amount')::int > p_returned then return null; end if;
  v_no := coalesce((d.fee_request->>'attempt_no')::int, 1) + 1;
  update refunds_due set fee_target_cents = greatest(coalesce(fee_target_cents, 0), p_target),
    fee_request_history = fee_request_history || jsonb_build_array(d.fee_request || jsonb_build_object(
      'provider_refund', p_refund, 'returned_cents', p_returned, 'fee_total_cents', p_fee_total,
      'outcome', case when p_refund is null then 'cannot_fit' else 'succeeded' end)),
    fee_request = jsonb_build_object('fee_id', d.fee_request->>'fee_id', 'amount', p_target - p_returned, 'attempt_no', v_no)
    where id = d.id returning fee_request into d.fee_request;
  return d.fee_request;
end;
$$;
revoke all on function public.advance_refund_due_fee(uuid, uuid, jsonb, int, int, int, text) from public, anon, authenticated;
grant execute on function public.advance_refund_due_fee(uuid, uuid, jsonb, int, int, int, text) to service_role;

create or replace function public.finish_refund_due_attempt(
  p_restaurant uuid, p_due uuid, p_attempt uuid, p_actor text, p_refund text, p_status text
) returns boolean language plpgsql security definer set search_path = public as $$
declare d refunds_due;
begin
  perform public.lock_restaurant_money(p_restaurant);
  select * into d from refunds_due where id = p_due and restaurant_id = p_restaurant for update;
  if d.id is null or d.refunded_at is not null then return false; end if;
  if p_attempt is distinct from (select id from refund_due_attempts where due_id = d.id order by attempt_no desc limit 1) then return false; end if;
  if p_status not in ('succeeded', 'pending', 'requires_action', 'failed', 'canceled') then raise exception 'invalid provider outcome'; end if;
  if p_refund is null then raise exception 'provider evidence required'; end if;
  update refund_due_attempts set stripe_refund_id = p_refund, provider_status = p_status, updated_at = now()
    where id = p_attempt and restaurant_id = p_restaurant;
  if p_status <> 'succeeded' then return false; end if;
  update refunds_due set refunded_at = now(), refunded_by = p_actor, stripe_refund_id = p_refund,
    fee_verification_pending = true where id = d.id;
  return true;
end;
$$;
revoke all on function public.finish_refund_due_attempt(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.finish_refund_due_attempt(uuid, uuid, uuid, text, text, text) to service_role;

revoke truncate, references, trigger on all tables in schema public from public, anon, authenticated;


-- A received held receipt is immutable and private. It remains available to
-- managers on another device, including after its collector signs out.
create table if not exists offline_sale_queue (
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  pos_ref uuid not null unique,
  body jsonb not null,
  collector text,
  currency text check (currency in ('MXN','USD')),
  submitted_by text not null,
  reason text not null,
  received_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz,
  primary key (restaurant_id, pos_ref)
);
alter table offline_sale_queue enable row level security;
revoke all on offline_sale_queue from public, authenticated;
revoke all on offline_sale_queue from anon;
grant all on offline_sale_queue to service_role;

create or replace function public.queue_offline_sale(
  p_restaurant uuid, p_ref uuid, p_body jsonb, p_collector text,
  p_currency text, p_actor text, p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare q offline_sale_queue%rowtype; v_ticket jsonb;
begin
  perform public.lock_restaurant_money(p_restaurant);
  if p_ref is null or lower(p_body->>'posRef') is distinct from p_ref::text
    or (p_body ? 'restaurantId' and p_body->>'restaurantId' is distinct from p_restaurant::text)
    or p_body->>'method' not in ('cash','card') or p_body->'offline' is null
    or nullif(btrim(p_actor),'') is null then raise exception 'invalid held receipt'; end if;
  select * into q from offline_sale_queue where pos_ref = p_ref for update;
  if found then
    if q.restaurant_id <> p_restaurant or q.body <> p_body then return jsonb_build_object('outcome','conflict'); end if;
    -- Even after approval, this exact receipt is safely retained on the server.
    return jsonb_build_object('queued',true,'orderId',p_ref,'receipt',q.body);
  end if;
  v_ticket := public.pos_ticket(p_restaurant,p_ref);
  if v_ticket is not null then
    if v_ticket->>'outcome' = 'settled'
      and (v_ticket->>'total')::numeric = (p_body->'offline'->>'total')::numeric
      and (not (p_body ? 'currency') or v_ticket->>'currency' = p_body->>'currency')
      and v_ticket->>'method' = p_body->>'method' then return v_ticket; end if;
    return jsonb_build_object('outcome','conflict');
  end if;
  insert into offline_sale_queue(restaurant_id,pos_ref,body,collector,currency,submitted_by,reason)
    values(p_restaurant,p_ref,p_body,p_collector,p_currency,p_actor,p_reason);
  return jsonb_build_object('queued',true,'orderId',p_ref,'receipt',p_body);
end;
$$;
revoke all on function public.queue_offline_sale(uuid,uuid,jsonb,text,text,text,text) from public,anon,authenticated;
grant execute on function public.queue_offline_sale(uuid,uuid,jsonb,text,text,text,text) to service_role;

-- Manager recovery preserves the held receipt and records who approved its
-- exceptions. No browser may rewrite that financial audit afterwards.
alter table orders add column if not exists offline_collector text;
alter table orders add column if not exists offline_approved_by text;
alter table orders add column if not exists offline_approved_at timestamptz;
alter table orders add column if not exists offline_recovery_reason text;
alter table orders add column if not exists offline_original_at text;
alter table orders add column if not exists offline_authority text;

create or replace function public.record_offline_sale(
  p_restaurant uuid, p_ref uuid, p_order jsonb, p_method text, p_actor text,
  p_at timestamptz, p_terminal text, p_demand jsonb,
  p_manager text, p_reason text, p_original_at text, p_authority text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ticket jsonb; q offline_sale_queue%rowtype;
begin
  perform public.lock_restaurant_money(p_restaurant);
  select * into q from offline_sale_queue where pos_ref = p_ref for update;
  if q.pos_ref is not null and (q.restaurant_id <> p_restaurant or p_manager is null) then
    raise exception 'manager approval required';
  end if;
  if p_at is null or p_at > now() + interval '5 minutes' or p_at < '2000-01-01'::timestamptz
    or p_method is null or p_method not in ('cash','card') or nullif(btrim(p_actor),'') is null
    or p_authority is null or p_authority not in ('signed','manager_attested') then raise exception 'invalid offline receipt'; end if;
  if p_manager is null then
    if p_authority <> 'signed' or p_reason is not null or p_at < now() - interval '30 days' then
      raise exception 'manager approval required';
    end if;
  else
    if not exists(select 1 from restaurants r join auth.users u on u.id = r.owner_id
      where r.id = p_restaurant and u.email = p_manager)
      and not exists(select 1 from staff where restaurant_id = p_restaurant and email = p_manager and role in ('owner','manager')) then
      raise exception 'manager approval required';
    end if;
    if length(btrim(coalesce(p_reason,''))) not between 8 and 500 then raise exception 'recovery reason required'; end if;
  end if;
  if p_manager is null and (p_order->>'currency') is distinct from (select currency from restaurants where id = p_restaurant) then
    raise exception 'manager approval required';
  end if;
  if p_manager is not null then
    if q.pos_ref is null or p_method is distinct from q.body->>'method'
      or (q.collector is not null and q.collector <> p_actor)
      or (q.currency is not null and q.currency is distinct from p_order->>'currency')
      or (p_order->>'subtotal')::numeric <> round((q.body->'offline'->>'subtotal')::numeric,2)
      or (p_order->>'service_fee')::numeric <> round((q.body->'offline'->>'serviceFee')::numeric,2)
      or (p_order->>'discount')::numeric <> round((q.body->'offline'->>'discount')::numeric,2)
      or (p_order->>'tip')::numeric <> round((q.body->'offline'->>'tip')::numeric,2)
      or (p_order->>'total')::numeric <> round((q.body->'offline'->>'total')::numeric,2) then
      raise exception 'held receipt changed';
    end if;
  end if;
  v_ticket := public.pos_ticket(p_restaurant, p_ref);
  if v_ticket is not null then
    if v_ticket->>'outcome' = 'settled' and exists(select 1 from orders where id = p_ref and restaurant_id = p_restaurant
      and (total <> (p_order->>'total')::numeric or currency <> p_order->>'currency' or pay_method <> p_method or account_id is not null)) then
      raise exception 'contradictory held receipt';
    end if;
    return v_ticket;
  end if;
  perform set_config('tabletap.offline_queue_writer', p_ref::text, true);
  v_ticket := public.ring_pos_sale_v2(p_restaurant, p_ref, p_order, p_method, p_actor,
    'completed', p_at, p_terminal, p_demand, false, 0);
  if v_ticket->>'outcome' <> 'settled' then return v_ticket; end if;
  perform set_config('tabletap.offline_audit_writer', p_ref::text, true);
  update orders set offline_collector = p_actor, offline_authority = p_authority,
    offline_approved_by = p_manager, offline_approved_at = case when p_manager is not null then now() end,
    offline_recovery_reason = p_reason, offline_original_at = left(p_original_at,80)
    where id = p_ref and restaurant_id = p_restaurant;
  insert into user_logs(restaurant_id,actor_email,entity,action,detail)
    values(p_restaurant,p_actor,'bill','paid','code=ORD-' || upper(left(p_ref::text,4)) || ' amount=' || to_char((p_order->>'total')::numeric,'FM999999990.00') || ' currency=' || (p_order->>'currency') || ' method=' || p_method);
  if p_manager is not null then
    insert into user_logs(restaurant_id,actor_email,entity,action,detail)
      values(p_restaurant,p_manager,'order','offline_recovered','code=ORD-' || upper(left(p_ref::text,4)) || ' note=' || replace(p_reason,' ','_'));
  end if;
  update offline_sale_queue set approved_by = p_manager, approved_at = now()
    where restaurant_id = p_restaurant and pos_ref = p_ref;
  return v_ticket || jsonb_build_object('currency',p_order->>'currency','method',p_method);
end;
$$;
revoke all on function public.record_offline_sale(uuid,uuid,jsonb,text,text,timestamptz,text,jsonb,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_offline_sale(uuid,uuid,jsonb,text,text,timestamptz,text,jsonb,text,text,text,text) to service_role;

create or replace function public.guard_offline_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.offline_collector is not null or new.offline_approved_by is not null or new.offline_approved_at is not null
      or new.offline_recovery_reason is not null or new.offline_original_at is not null or new.offline_authority is not null then
      raise exception 'offline approval is private';
    end if;
    return new;
  end if;
  if (new.offline_collector,new.offline_approved_by,new.offline_approved_at,new.offline_recovery_reason,new.offline_original_at,new.offline_authority)
    is distinct from (old.offline_collector,old.offline_approved_by,old.offline_approved_at,old.offline_recovery_reason,old.offline_original_at,old.offline_authority)
    and current_setting('tabletap.offline_audit_writer',true) is distinct from new.id::text then
    raise exception 'offline approval is immutable';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_offline_audit() from public,anon,authenticated;
drop trigger if exists guard_offline_audit on orders;
create trigger guard_offline_audit before insert or update on orders for each row execute function public.guard_offline_audit();
revoke truncate, references, trigger on all tables in schema public from authenticated;
revoke truncate, references, trigger on all tables in schema public from public, anon, authenticated;

-- The pass reads preparation facts, not sales. A separate id matters too:
-- orders.id is the credential a diner uses to open a bill without a login.
alter table orders add column if not exists kitchen_ticket_id uuid not null default gen_random_uuid();
create unique index if not exists orders_kitchen_ticket_id on orders(kitchen_ticket_id);

create table if not exists kitchen_tickets (
  id uuid primary key references orders(kitchen_ticket_id) on delete cascade,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  code text not null,
  table_label text,
  customer_name text,
  status text not null,
  stations_ready text[] not null default '{}',
  items jsonb not null,
  note text,
  created_at timestamptz not null
);
create index if not exists kitchen_tickets_board on kitchen_tickets(restaurant_id, status, created_at);
alter table kitchen_tickets enable row level security;
revoke all on kitchen_tickets from anon;
revoke all on kitchen_tickets from public, authenticated;
grant select on kitchen_tickets to authenticated;
grant all on kitchen_tickets to service_role;
drop policy if exists "team reads kitchen tickets" on kitchen_tickets;
create policy "team reads kitchen tickets" on kitchen_tickets for select to authenticated
  using (works_at(restaurant_id));

-- Build from an allowlist at every depth: removing just price missed extras,
-- combo components and any new money field added to order snapshots later.
create or replace function public.kitchen_items(p_items jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'name', line->'name', 'emoji', line->'emoji', 'qty', line->'qty',
    'mods', line->'mods', 'notes', line->'notes',
    'station', line->'station', 'skipsKitchen', line->'skipsKitchen',
    'extras', kitchen_items(line->'extras'),
    'components', kitchen_items(line->'components')
  )) order by n), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end)
    with ordinality as lines(line, n);
$$;
revoke all on function public.kitchen_items(jsonb) from public, anon, authenticated;
grant execute on function public.kitchen_items(jsonb) to service_role;

-- Atomic with the order: status, station readiness, edits and cancellation all
-- reach the same feed. Terminal updates remain readable so the board removes
-- finished tickets; pending checkouts never reach the pass.
create or replace function public.sync_kitchen_ticket()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'pending_payment' then
    insert into kitchen_tickets (id, restaurant_id, code, table_label, customer_name,
      status, stations_ready, items, note, created_at)
    values (new.kitchen_ticket_id, new.restaurant_id, left(replace(new.id::text, '-', ''), 4),
      new.table_label, new.customer_name,
      case when new.written_off then 'cancelled' else new.status end, new.stations_ready,
      kitchen_items(new.items), new.note, new.created_at)
    on conflict (id) do update set restaurant_id = excluded.restaurant_id,
      code = excluded.code, table_label = excluded.table_label, customer_name = excluded.customer_name,
      status = excluded.status, stations_ready = excluded.stations_ready,
      items = excluded.items, note = excluded.note, created_at = excluded.created_at;
  end if;
  return new;
end; $$;
revoke all on function public.sync_kitchen_ticket() from public, anon, authenticated;
grant execute on function public.sync_kitchen_ticket() to service_role;
drop trigger if exists orders_sync_kitchen_ticket on orders;
create trigger orders_sync_kitchen_ticket after insert or update on orders
  for each row execute function public.sync_kitchen_ticket();

-- Lock the initial copy against concurrent moves, or an older snapshot could
-- overwrite a newer trigger result on a busy pass during rollout.
do $$ begin
  lock table orders in share row exclusive mode;
  insert into kitchen_tickets (id, restaurant_id, code, table_label, customer_name,
    status, stations_ready, items, note, created_at)
  select kitchen_ticket_id, restaurant_id, left(replace(id::text, '-', ''), 4),
    table_label, customer_name, case when written_off then 'cancelled' else status end,
    stations_ready, kitchen_items(items), note, created_at
  from orders where status in ('received', 'preparing', 'ready')
  on conflict (id) do update set restaurant_id = excluded.restaurant_id,
    code = excluded.code, table_label = excluded.table_label, customer_name = excluded.customer_name,
    status = excluded.status, stations_ready = excluded.stations_ready,
    items = excluded.items, note = excluded.note, created_at = excluded.created_at;
end $$;
do $$ begin
  alter publication supabase_realtime add table kitchen_tickets;
exception when duplicate_object then null;
end $$;

-- A table UUID is a public bill credential too. Keep the kitchen's live calls
-- and its done button without letting those calls reveal a diner's bill.
create table if not exists kitchen_requests (
  id uuid primary key references service_requests(id) on delete cascade,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  table_label text not null,
  kind text not null,
  status text not null,
  created_at timestamptz not null
);
create index if not exists kitchen_requests_open on kitchen_requests(restaurant_id, status, created_at);
alter table kitchen_requests enable row level security;
revoke all on kitchen_requests from anon;
revoke all on kitchen_requests from public, authenticated;
grant select on kitchen_requests to authenticated;
grant all on kitchen_requests to service_role;
drop policy if exists "team reads kitchen calls" on kitchen_requests;
create policy "team reads kitchen calls" on kitchen_requests for select to authenticated
  using (works_at(restaurant_id));

create or replace function public.sync_kitchen_request()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into kitchen_requests (id, restaurant_id, table_label, kind, status, created_at)
  values (new.id, new.restaurant_id, new.table_label, new.kind, new.status, new.created_at)
  on conflict (id) do update set restaurant_id = excluded.restaurant_id,
    table_label = excluded.table_label, kind = excluded.kind, status = excluded.status,
    created_at = excluded.created_at;
  return new;
end; $$;
revoke all on function public.sync_kitchen_request() from public, anon, authenticated;
grant execute on function public.sync_kitchen_request() to service_role;
drop trigger if exists service_requests_sync_kitchen on service_requests;
create trigger service_requests_sync_kitchen after insert or update on service_requests
  for each row execute function public.sync_kitchen_request();

do $$ begin
  lock table service_requests in share row exclusive mode;
  insert into kitchen_requests (id, restaurant_id, table_label, kind, status, created_at)
  select id, restaurant_id, table_label, kind, status, created_at from service_requests where status = 'open'
  on conflict (id) do update set restaurant_id = excluded.restaurant_id,
    table_label = excluded.table_label, kind = excluded.kind, status = excluded.status,
    created_at = excluded.created_at;
end $$;
do $$ begin
  alter publication supabase_realtime add table kitchen_requests;
exception when duplicate_object then null;
end $$;
revoke truncate, references, trigger on all tables in schema public from authenticated;
revoke truncate, references, trigger on all tables in schema public from public, anon, authenticated;

-- Every payable attempt has one owner, including fee-free plans. Its Stripe
-- request is kept intact so a lost response is retried with the same key.
create or replace function public.diner_checkout_open(p_record jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_new diner_checkouts;
  v_prior diner_checkouts;
  v_order orders;
  v_coupon uuid := (p_record->>'coupon_id')::uuid;
  v_discount numeric;
  v_expected numeric;
  v_entitled numeric;
  v_tip numeric;
begin
  v_new := jsonb_populate_record(null::diner_checkouts, p_record);
  perform public.lock_restaurant_money(v_new.restaurant_id);
  perform public.backfill_payment_allocations(v_new.restaurant_id);
  select * into v_prior from diner_checkouts c
   where c.restaurant_id = v_new.restaurant_id and c.status = 'open'
     and (c.scope_key = v_new.scope_key or c.payable_order_ids && v_new.payable_order_ids
       or (c.order_ids && v_new.order_ids and not (
         coalesce(c.metadata->>'split_id', '') <> '' and c.metadata->>'split_id' = coalesce(v_new.metadata->>'split_id', ''))))
   order by c.created_at limit 1 for update;
  if found then
    if v_prior.scope_key = v_new.scope_key then return to_jsonb(v_prior); end if;
    raise exception 'checkout_scope_busy';
  end if;
  if cardinality(v_new.order_ids) = 0 or exists (
    select 1 from unnest(v_new.order_ids) x left join orders o on o.id = x
     where o.id is null or o.restaurant_id <> v_new.restaurant_id or o.currency <> v_new.currency
  ) then raise exception 'checkout_scope_changed'; end if;
  perform 1 from orders where id = any(v_new.order_ids) order by id for update;
  if not v_new.payable_order_ids <@ v_new.order_ids then raise exception 'checkout_scope_changed'; end if;
  for v_order in select * from orders where id = any(v_new.payable_order_ids) loop
    if v_order.paid or v_order.written_off or v_order.status in ('cancelled', 'pending_payment') then
      raise exception 'checkout_scope_changed';
    end if;
    v_expected := (v_new.entitlements->>v_order.id::text)::numeric
      + coalesce((v_new.order_discounts->>v_order.id::text)::numeric, 0);
    if v_expected is null or abs(v_expected - greatest(v_order.total - public.retained_order_coverage(v_new.restaurant_id, v_order.id), 0)) > 0.005 then
      raise exception 'checkout_amount_changed';
    end if;
  end loop;
  -- The discount is frozen per order before a payable page exists. Settlement
  -- lowers those entitlements in the same transaction that writes receipts.
  select coalesce(sum(value::numeric), 0) into v_discount from jsonb_each_text(v_new.order_discounts);
  if v_discount < 0 or v_discount <> coalesce((v_new.metadata->>'settle_discount')::numeric, 0) then
    raise exception 'checkout_discount_changed';
  end if;
  select coalesce(sum(value::numeric), 0) into v_entitled from jsonb_each_text(v_new.entitlements);
  v_tip := coalesce((v_new.metadata->>'settle_tip')::numeric,
    (select tip from account_checkouts where id = (v_new.metadata->>'account_checkout')::uuid), 0);
  if v_new.amount_cents <> round((v_entitled + v_tip + coalesce((v_new.metadata->>'split_amount')::numeric, 0)) * 100)
    or v_new.food_principal is null or v_new.food_principal < 0
    or exists (select 1 from jsonb_each_text(v_new.entitlements) where value::numeric < 0)
    or exists (select 1 from jsonb_each_text(v_new.order_discounts) where value::numeric < 0) then
    raise exception 'checkout_amount_changed';
  end if;
  if v_coupon is not null then
    if exists (select 1 from orders where id = any(v_new.payable_order_ids)
      and (coupon_code is not null or public.retained_order_coverage(v_new.restaurant_id, id) > 0))
      or not exists (select 1 from coupons where id = v_coupon and restaurant_id = v_new.restaurant_id and not staff_only)
      or public.redeem_coupon(v_coupon) is null then raise exception 'checkout_coupon_unavailable'; end if;
  end if;
  insert into diner_checkouts (id, restaurant_id, stripe_account_id, livemode, currency, amount_cents,
    metadata, order_ids, payable_order_ids, scope_key, idempotency_key, stripe_params, entitlements, order_discounts, food_principal)
  values (v_new.id, v_new.restaurant_id, v_new.stripe_account_id, v_new.livemode, v_new.currency, v_new.amount_cents,
    v_new.metadata, v_new.order_ids, v_new.payable_order_ids, v_new.scope_key, v_new.idempotency_key,
    v_new.stripe_params, v_new.entitlements, v_new.order_discounts, v_new.food_principal);
  if v_coupon is not null then
    insert into coupon_redemptions (restaurant_id, coupon_id, order_id, code, amount, checkout_attempt_id)
    values (v_new.restaurant_id, v_coupon, v_new.payable_order_ids[1], v_new.metadata->>'settle_coupon', v_discount, v_new.id);
  end if;
  -- Marked before Stripe hears of it: service repricing cannot change the
  -- quote between the diner opening the page and its webhook landing.
  update orders set card_checkout_at = now() where id = any(v_new.order_ids);
  select * into v_new from diner_checkouts where id = v_new.id;
  return to_jsonb(v_new);
end; $$;
revoke all on function public.diner_checkout_open(jsonb) from public, anon, authenticated;
grant execute on function public.diner_checkout_open(jsonb) to service_role;

create or replace function public.diner_checkout_bind(p_attempt uuid, p_record jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare c diner_checkouts;
begin
  select * into c from diner_checkouts where id = p_attempt for update;
  if not found or (c.stripe_session_id is not null and c.stripe_session_id <> p_record->>'stripe_session_id')
    or c.restaurant_id::text <> p_record->>'restaurant_id'
    or c.stripe_account_id <> p_record->>'stripe_account_id'
    or c.currency <> p_record->>'currency' or c.amount_cents <> (p_record->>'amount_cents')::int
    or c.livemode <> (p_record->>'livemode')::boolean or c.metadata <> p_record->'metadata' then
    raise exception 'checkout_provenance_changed';
  end if;
  update diner_checkouts set stripe_session_id = p_record->>'stripe_session_id' where id = p_attempt;
end; $$;
revoke all on function public.diner_checkout_bind(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.diner_checkout_bind(uuid, jsonb) to service_role;

create or replace function public.finish_diner_checkout(p_attempt uuid, p_paid boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_checkout diner_checkouts; r record;
begin
  perform public.lock_restaurant_money((select restaurant_id from diner_checkouts where id = p_attempt));
  select * into v_checkout from diner_checkouts where id = p_attempt for update;
  if not found then raise exception 'checkout_missing'; end if;
  if v_checkout.status = 'paid' then return; end if;
  if p_paid then
    update coupon_redemptions set confirmed_at = coalesce(confirmed_at, now())
     where checkout_attempt_id = v_checkout.id;
    update diner_checkouts set status = 'paid' where id = p_attempt;
  elsif v_checkout.status = 'open' then
    for r in delete from coupon_redemptions where checkout_attempt_id = v_checkout.id
      and confirmed_at is null returning coupon_id loop
      if r.coupon_id is not null then perform public.release_coupon(r.coupon_id); end if;
    end loop;
    update diner_checkouts set status = 'expired' where id = p_attempt;
    if v_checkout.metadata->>'fee_id' is not null then
      perform public.release_platform_fee((v_checkout.metadata->>'fee_id')::uuid);
    end if;
    if v_checkout.metadata->>'account_checkout' is not null then
      perform public.account_checkout_release((v_checkout.metadata->>'account_checkout')::uuid);
    end if;
  end if;
end; $$;
revoke all on function public.finish_diner_checkout(uuid, boolean) from public, anon, authenticated;
grant execute on function public.finish_diner_checkout(uuid, boolean) to service_role;

-- A pay-now order reserved its coupon before its Stripe session existed.
-- Bind that reservation once; an old expiry can never pick up a newer one.
create or replace function public.bind_diner_coupon()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.metadata->>'order_id' is not null and new.stripe_session_id is not null then
    update coupon_redemptions set checkout_attempt_id = new.id
     where order_id = (new.metadata->>'order_id')::uuid and confirmed_at is null and checkout_attempt_id is null;
  end if;
  return new;
end; $$;
revoke all on function public.bind_diner_coupon() from public, anon, authenticated;
grant execute on function public.bind_diner_coupon() to service_role;
drop trigger if exists bind_diner_coupon on diner_checkouts;
create trigger bind_diner_coupon after insert or update of stripe_session_id on diner_checkouts
for each row execute function public.bind_diner_coupon();

-- Older deployed carts log their redemption after Stripe answers. Locking the
-- attempt also covers a webhook before that insert during the deployment overlap.
create or replace function public.bind_redemption_checkout()
returns trigger language plpgsql security definer set search_path = public as $$
declare c diner_checkouts;
begin
  if new.confirmed_at is not null or new.checkout_attempt_id is not null then return new; end if;
  select * into c from diner_checkouts where metadata->>'order_id' = new.order_id::text
    and stripe_session_id is not null order by created_at desc limit 1 for update;
  if found then
    if c.status = 'expired' then raise exception 'checkout_expired'; end if;
    new.checkout_attempt_id := c.id;
    if c.status = 'paid' then new.confirmed_at := now(); end if;
  end if;
  return new;
end; $$;
revoke all on function public.bind_redemption_checkout() from public, anon, authenticated;
grant execute on function public.bind_redemption_checkout() to service_role;
drop trigger if exists bind_redemption_checkout on coupon_redemptions;
create trigger bind_redemption_checkout before insert on coupon_redemptions
for each row execute function public.bind_redemption_checkout();
create unique index if not exists coupon_one_checkout_reservation on coupon_redemptions(checkout_attempt_id)
where checkout_attempt_id is not null;

-- A printed QR names a table, never the people eating there now. Only the
-- server sees credentials; the floor polls a route that returns pending ids.
create table if not exists table_session_members (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references table_sessions(id) on delete cascade,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  unique (session_id, token_hash)
);
alter table table_session_members enable row level security;
revoke all on table_session_members from anon;
revoke all on table_session_members from public, authenticated;
grant all on table_session_members to service_role;
create index if not exists table_session_members_pending
  on table_session_members(session_id, created_at) where status = 'pending';

-- Lock the physical table before deciding who arrived first. A loser to a
-- simultaneous diner or staff opener must request admission, never inherit it.
create or replace function public.request_table_member(
  p_restaurant uuid, p_table uuid, p_hash text, p_open boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_session uuid;
  v_created boolean := false;
  v_member table_session_members%rowtype;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid member credential'; end if;
  perform 1 from restaurant_tables where id = p_table and restaurant_id = p_restaurant for update;
  if not found then raise exception 'Table not found'; end if;
  if p_open then
    update table_sessions set closed_at = now(), close_reason = 'expired'
      where table_id = p_table and restaurant_id = p_restaurant and closed_at is null
        and opened_at < now() - interval '8 hours';
  end if;
  select id into v_session from table_sessions
    where table_id = p_table and restaurant_id = p_restaurant and closed_at is null
      and opened_at >= now() - interval '8 hours';
  if v_session is null and not p_open then
    return jsonb_build_object('status', 'empty', 'sessionId', null, 'diner', null);
  end if;
  if v_session is null then
    insert into table_sessions(restaurant_id, table_id) values (p_restaurant, p_table)
      on conflict do nothing returning id into v_session;
    v_created := v_session is not null;
    if v_session is null then
      select id into v_session from table_sessions
        where table_id = p_table and restaurant_id = p_restaurant and closed_at is null;
    end if;
  end if;
  if v_session is null then raise exception 'Could not open sitting'; end if;
  insert into table_session_members(session_id, token_hash, status, decided_at)
    values (v_session, p_hash, case when v_created then 'approved' else 'pending' end,
      case when v_created then now() else null end)
    on conflict (session_id, token_hash) do nothing;
  select * into strict v_member from table_session_members where session_id = v_session and token_hash = p_hash;
  return jsonb_build_object('status', v_member.status, 'sessionId', v_session, 'diner', v_member.id);
end; $$;
revoke all on function public.request_table_member(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.request_table_member(uuid, uuid, text, boolean) to service_role;

-- A decision can only change a pending phone in this sitting. Serializing on
-- the sitting also prevents an approval from reviving a closed party.
create or replace function public.decide_table_member(
  p_member uuid, p_restaurant uuid, p_table uuid, p_approve boolean,
  p_staff text default null, p_hash text default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_session uuid;
begin
  select s.id into v_session from table_sessions s join table_session_members m on m.session_id = s.id
    where m.id = p_member and s.restaurant_id = p_restaurant and s.table_id = p_table
      and s.closed_at is null and s.opened_at >= now() - interval '8 hours' for update of s;
  if v_session is null then return false; end if;
  if p_staff is null and not exists (
    select 1 from table_session_members where session_id = v_session and token_hash = p_hash and status = 'approved'
  ) then return false; end if;
  update table_session_members set status = case when p_approve then 'approved' else 'rejected' end,
    decided_at = now(), decided_by = coalesce(p_staff, 'member')
    where id = p_member and session_id = v_session and status = 'pending';
  return found;
end; $$;
revoke all on function public.decide_table_member(uuid, uuid, uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.decide_table_member(uuid, uuid, uuid, boolean, text, text) to service_role;

revoke truncate, references, trigger on all tables in schema public from authenticated;

-- ── Prices the database will hold (security review J3, J4) ──────────────────
-- Managers write promotions and dishes directly under their policies, and the
-- order verifier trusts the stored price: a combo at -90 made the rest of a
-- MX$100 cart cost MX$10, and a tier of 1e-20 units froze pricing for every
-- restaurant. No row broke these when they were added (dev and production).
create or replace function public.tiers_sound(p_tiers jsonb)
returns boolean language sql immutable set search_path = public as $$
  select p_tiers is null or (jsonb_typeof(p_tiers) = 'array' and jsonb_array_length(p_tiers) <= 20
    and not exists (select 1 from jsonb_array_elements(p_tiers) t
      where jsonb_typeof(t->'qty') <> 'number' or jsonb_typeof(t->'price') <> 'number'
         or (t->>'qty')::numeric < 1 or (t->>'qty')::numeric > 1000
         or (t->>'qty')::numeric <> floor((t->>'qty')::numeric) or (t->>'price')::numeric <= 0));
$$;
revoke all on function public.tiers_sound(jsonb) from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'menu_items_price_not_negative') then
    alter table menu_items add constraint menu_items_price_not_negative check (price >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'promotions_combo_price_not_negative') then
    alter table promotions add constraint promotions_combo_price_not_negative check (combo_price is null or combo_price >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'promotions_tiers_sound') then
    alter table promotions add constraint promotions_tiers_sound check (public.tiers_sound(tiers));
  end if;
end $$;

-- Changing a CHECK's helper does not recheck existing rows. Re-add it so a
-- zero-price tier must be corrected before this schema can be applied.
alter table promotions drop constraint if exists promotions_tiers_sound;
alter table promotions add constraint promotions_tiers_sound check (public.tiers_sound(tiers));

-- S17: a restaurant's deletion cannot erase money it still owes or its books.
-- No foreign keys on the audit: actor and target must survive their deletion.
create table if not exists platform_admin_audit (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  actor_id uuid not null,
  actor_email text not null,
  target_type text not null check (target_type in ('restaurant', 'login')),
  target_id text,
  action text not null check (action in ('login.create', 'login.update', 'login.delete', 'restaurant.delete', 'restaurant.plan')),
  outcome text not null check (outcome in ('started', 'succeeded', 'refused', 'uncertain')),
  before_facts jsonb not null default '{}'::jsonb check (jsonb_typeof(before_facts) = 'object'),
  after_facts jsonb not null default '{}'::jsonb check (jsonb_typeof(after_facts) = 'object')
);
create index if not exists platform_admin_audit_time on platform_admin_audit(created_at desc, id desc);
create index if not exists platform_admin_audit_attempt on platform_admin_audit(attempt_id);
alter table platform_admin_audit enable row level security;
revoke all on platform_admin_audit from anon, authenticated, public, service_role;
grant select, insert on platform_admin_audit to service_role;

-- Even a service-side mistake must append a correction, never rewrite history.
create or replace function public.keep_platform_admin_audit()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Platform admin audit is append-only';
end;
$$;
revoke all on function public.keep_platform_admin_audit() from public, anon, authenticated;
grant execute on function public.keep_platform_admin_audit() to service_role;
drop trigger if exists platform_admin_audit_immutable on platform_admin_audit;
create trigger platform_admin_audit_immutable before update or delete or truncate
  on platform_admin_audit for each statement execute function public.keep_platform_admin_audit();

-- Accounting survives the live restaurant. Keep original IDs and row contents,
-- not a restaurant/profile copy; no FK may cascade this retained record away.
create table if not exists restaurant_accounting_records (
  restaurant_id uuid not null,
  source_table text not null,
  source_id uuid not null,
  row_data jsonb not null,
  retained_at timestamptz not null default now(),
  primary key (restaurant_id, source_table, source_id)
);
alter table restaurant_accounting_records enable row level security;
revoke all on restaurant_accounting_records from anon;
revoke all on restaurant_accounting_records from public, authenticated, service_role;
-- Only the guarded definer copies records. Service deletion permits expiry
-- under the privacy notice and removal of disposable API fixtures.
grant select, delete on restaurant_accounting_records to service_role;

-- A missing fee row is not evidence of no fee. A saved checkout that asked
-- for no application fee, or a fee returned in full, is. This also releases
-- pre-field completed refunds without trusting today's menu or local rounding.
create or replace function public.refund_fee_proven_clear(p_restaurant uuid, p_intent text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_fees f where f.restaurant_id = p_restaurant
      and f.stripe_payment_intent = p_intent and f.status = 'taken' and f.refunded_cents = f.cents)
    or (exists (select 1 from diner_checkouts c where c.restaurant_id = p_restaurant
      and c.stripe_payment_intent = p_intent and c.status = 'paid'
      and coalesce(c.metadata->>'fee_cents', '0') = '0'
      and not (c.metadata ? 'fee_id')
      and coalesce(c.stripe_params #>> '{payment_intent_data,application_fee_amount}', '0') = '0')
    and not exists (select 1 from platform_fees f where f.restaurant_id = p_restaurant
      and f.stripe_payment_intent = p_intent and f.status = 'taken')
    and not exists (select 1 from refunds_due d where d.restaurant_id = p_restaurant
      and d.stripe_payment_intent = p_intent and coalesce((d.fee_request->>'amount')::int, 0) > 0));
$$;
revoke all on function public.refund_fee_proven_clear(uuid, text) from public, anon, authenticated;
grant execute on function public.refund_fee_proven_clear(uuid, text) to service_role;

-- Idempotent on reapplication: never turn a verified zero back into unknown.
-- Rows without proof stay recoverable through the ordinary fee-only retries.
-- Only the new column is written: an existing row's fee_reconciled_at is its
-- own record, and stamping it now() would be a change to production's data.
update refunds_due d set fee_verification_pending = false
  where d.refunded_at is not null and d.fee_verification_pending
    and (d.fee_reconciled_at is not null or public.refund_fee_proven_clear(d.restaurant_id, d.stripe_payment_intent));
update refund_operations r set fee_verification_pending = false
  where r.status = 'succeeded' and r.fee_verification_pending
    and (r.source <> 'stripe' or r.fee_reconciled_at is not null
      or public.refund_fee_proven_clear(r.restaurant_id, r.stripe_payment_intent));

create or replace function public.admin_delete_restaurant(p_restaurant uuid, p_check_only boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_table text;
begin
  perform public.lock_restaurant_money(p_restaurant);
  -- FK inserts take a key-share lock here. Once held, no new receipt or
  -- obligation can arrive between these checks and the cascading deletion.
  perform 1 from restaurants where id = p_restaurant for update;
  if not found then return jsonb_build_object('outcome', 'gone'); end if;
  if exists (select 1 from refund_operations where restaurant_id = p_restaurant and status <> 'succeeded') then
    return jsonb_build_object('outcome', 'refund');
  end if;
  if exists (select 1 from refunds_due where restaurant_id = p_restaurant and refunded_at is null) then
    return jsonb_build_object('outcome', 'refundDue');
  end if;
  if exists (select 1 from refund_attempts where restaurant_id = p_restaurant
      and (provider_status is null or provider_status not in ('succeeded', 'failed', 'canceled')))
    or exists (select 1 from refund_due_attempts where restaurant_id = p_restaurant
      and (provider_status is null or provider_status not in ('succeeded', 'failed', 'canceled')))
    or exists (select 1 from diner_checkouts where restaurant_id = p_restaurant and status = 'open')
    or exists (select 1 from account_checkouts where restaurant_id = p_restaurant and status = 'open')
    or exists (select 1 from platform_fees where restaurant_id = p_restaurant and status = 'open') then
    return jsonb_build_object('outcome', 'provider');
  end if;
  if exists (select 1 from offline_sale_queue where restaurant_id = p_restaurant and approved_at is null) then
    return jsonb_build_object('outcome', 'offlineSale');
  end if;
  -- Customer completion commits before the first provider read. Unknown is
  -- protected even when the local ten-cent share rounds to zero, in both books.
  if exists (select 1 from refunds_due d where d.restaurant_id = p_restaurant
      and d.refunded_at is not null and d.fee_verification_pending and d.fee_reconciled_at is null
      and not public.refund_fee_proven_clear(p_restaurant, d.stripe_payment_intent))
    or exists (select 1 from refund_operations r where r.restaurant_id = p_restaurant
      and r.source = 'stripe' and r.status = 'succeeded' and r.fee_verification_pending and r.fee_reconciled_at is null
      and not public.refund_fee_proven_clear(p_restaurant, r.stripe_payment_intent)) then
    return jsonb_build_object('outcome', 'refundFeeVerification');
  end if;
  -- Stripe returns the cumulative rounded share, not a fee for every row.
  -- No fee, an already returned share, or a share rounding to zero owes nothing.
  if exists (
    select 1 from platform_fees f where f.restaurant_id = p_restaurant and f.status = 'taken'
      and f.charge_cents > 0 and f.refunded_cents < round(f.cents::numeric * least(f.charge_cents, 100 * (
        coalesce((select sum(d.amount) from refunds_due d where d.restaurant_id = p_restaurant
          and d.stripe_payment_intent = f.stripe_payment_intent and d.refunded_at is not null), 0)
        + coalesce((select sum(r.amount) from refund_operations r where r.restaurant_id = p_restaurant
          and r.stripe_payment_intent = f.stripe_payment_intent and r.source = 'stripe' and r.status = 'succeeded'), 0)
      )) / f.charge_cents)
      and (exists (select 1 from refunds_due d where d.restaurant_id = p_restaurant
        and d.stripe_payment_intent = f.stripe_payment_intent and d.refunded_at is not null and d.fee_reconciled_at is null)
      or exists (select 1 from refund_operations r where r.restaurant_id = p_restaurant
        and r.stripe_payment_intent = f.stripe_payment_intent and r.source = 'stripe'
        and r.status = 'succeeded' and r.fee_reconciled_at is null))
  ) or exists (
    -- A provider-verified fee request is evidence of its own, ledger row or
    -- not. The arithmetic above sees only the refunds this app recorded: a
    -- charge refunded in full outside it left MX$3 of fee to return while the
    -- local share rounded to zero, and the restaurant could be deleted owed
    -- that (cross-review of batch 5). Only a share already returned in full
    -- lets it go.
    select 1 from refunds_due d where d.restaurant_id = p_restaurant and d.refunded_at is not null
      and d.fee_reconciled_at is null and coalesce((d.fee_request->>'amount')::numeric, 0) > 0
      and not exists (select 1 from platform_fees f where f.restaurant_id = p_restaurant
        and f.stripe_payment_intent = d.stripe_payment_intent and f.status = 'taken'
        and f.refunded_cents = f.cents)
  ) then return jsonb_build_object('outcome', 'refundFee'); end if;
  -- Retain completed refunds too. Closing a real business does not make its
  -- receipts disposable, but completed books must not prevent its deletion.
  if p_check_only is distinct from false then return jsonb_build_object('outcome', 'ready'); end if;
  foreach v_table in array array[
    'orders', 'payments', 'payment_allocations', 'refund_operations',
    'refund_allocations', 'refund_attempts', 'order_adjustments', 'refunds_due',
    'refund_due_attempts', 'platform_fees', 'cash_shifts', 'cash_movements',
    'terminal_deposits', 'customer_accounts', 'ingredient_purchases',
    'account_checkouts', 'diner_checkouts', 'table_sessions', 'user_logs'
  ] loop
    -- Lock existing rows as they are copied too: an update must not change a
    -- receipt after its copy. A failed copy or cascade rolls back both writes.
    -- Account email is only kept while open; its statement code grants access.
    execute format(
      'insert into restaurant_accounting_records (restaurant_id, source_table, source_id, row_data)
       select $1, %L, t.id, to_jsonb(t) - $2
       from (select * from public.%I where restaurant_id = $1 for update) t', v_table, v_table)
      using p_restaurant, case when v_table = 'customer_accounts' then array['email', 'code'] else array[]::text[] end;
  end loop;
  -- The queue uses pos_ref as its identity, not the id the other books use.
  insert into restaurant_accounting_records (restaurant_id, source_table, source_id, row_data)
    select p_restaurant, 'offline_sale_queue', q.pos_ref, to_jsonb(q)
    from (select * from offline_sale_queue where restaurant_id = p_restaurant for update) q;
  -- The privacy notice keeps admission decisions with the visit and orders.
  -- Members have no restaurant_id; reach them only through this restaurant's visits.
  insert into restaurant_accounting_records (restaurant_id, source_table, source_id, row_data)
    select p_restaurant, 'table_session_members', t.id, to_jsonb(t)
    from (select m.* from table_session_members m join table_sessions s on s.id = m.session_id
      where s.restaurant_id = p_restaurant for update of m) t;
  delete from restaurants where id = p_restaurant;
  return jsonb_build_object('outcome', 'deleted');
end;
$$;
revoke all on function public.admin_delete_restaurant(uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_delete_restaurant(uuid, boolean) to service_role;

revoke truncate, references, trigger on all tables in schema public from authenticated;
-- S14: an offer's terms and products commit together. Additive for old callers.
create or replace function public.save_promotion_v1(
  p_restaurant uuid, p_id uuid, p_fields jsonb, p_items jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_status text;
begin
  -- Serialize with plan changes before checking the freeze or replacing links.
  select plan_status into v_status from restaurants where id = p_restaurant for no key update;
  if not found then raise exception 'tt_restaurant_missing'; end if;
  if v_status = 'locked' then raise exception 'tt_plan_frozen' using errcode = 'check_violation'; end if;

  if p_id is not null then
    select id into v_id from promotions where id = p_id and restaurant_id = p_restaurant for update;
    if not found then return null; end if;
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'tt_promotion_items_required' using errcode = 'check_violation';
  end if;
  -- Lock dishes in order so a concurrent move or delete cannot invalidate
  -- ownership between checking it and writing the foreign keys.
  perform 1 from menu_items where restaurant_id = p_restaurant
    and id in (select x.item_id from jsonb_to_recordset(p_items) as x(item_id uuid, qty int))
    order by id for share;
  -- Recheck ownership inside the write: a preflight read is not a boundary.
  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(item_id uuid, qty int)
    left join menu_items i on i.id = x.item_id and i.restaurant_id = p_restaurant
    where i.id is null or x.qty is null or x.qty < 1
  ) then raise exception 'tt_promotion_unknown_item' using errcode = 'check_violation'; end if;

  if p_id is null then
    insert into promotions (restaurant_id, kind, name, emoji, description, combo_price, buy_qty, pay_qty, tiers)
    values (p_restaurant, p_fields->>'kind', p_fields->>'name', p_fields->>'emoji', p_fields->>'description',
      (p_fields->>'combo_price')::numeric, (p_fields->>'buy_qty')::int, (p_fields->>'pay_qty')::int,
      nullif(p_fields->'tiers', 'null'::jsonb)) returning id into v_id;
  else
    update promotions set kind = p_fields->>'kind', name = p_fields->>'name', emoji = p_fields->>'emoji',
      description = p_fields->>'description', combo_price = (p_fields->>'combo_price')::numeric,
      buy_qty = (p_fields->>'buy_qty')::int, pay_qty = (p_fields->>'pay_qty')::int,
      tiers = nullif(p_fields->'tiers', 'null'::jsonb)
    where id = v_id and restaurant_id = p_restaurant;
  end if;
  delete from promotion_items where promotion_id = v_id;
  insert into promotion_items (promotion_id, item_id, qty)
    select v_id, x.item_id, x.qty from jsonb_to_recordset(p_items) as x(item_id uuid, qty int);
  return v_id;
end $$;
revoke all on function public.save_promotion_v1(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_promotion_v1(uuid, uuid, jsonb, jsonb) to service_role;

-- Browser writes obey the same freeze as the routes. Coupon claims by the
-- server must still work: a billing freeze never prevents a diner from paying.
create or replace function public.enforce_offer_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_restaurant uuid;
  v_next uuid;
  v_frozen boolean;
begin
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_table_name = 'promotion_items' then
    if tg_op <> 'INSERT' then
      select restaurant_id into v_restaurant from promotions where id = old.promotion_id;
    end if;
    if tg_op <> 'DELETE' then
      select restaurant_id into v_next from promotions where id = new.promotion_id;
    end if;
  else
    if tg_op <> 'INSERT' then v_restaurant := old.restaurant_id; end if;
    if tg_op <> 'DELETE' then v_next := new.restaurant_id; end if;
  end if;
  select exists (select 1 from restaurants where id in (v_restaurant, v_next) and plan_status = 'locked') into v_frozen;
  if v_frozen then
    -- Nothing besides active may change, including ownership and usage counts.
    if tg_table_name <> 'promotion_items' and tg_op = 'UPDATE' then
      if new.active = false and (to_jsonb(new) - 'active') = (to_jsonb(old) - 'active') then return new; end if;
    end if;
    raise exception 'tt_plan_frozen' using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.enforce_offer_write() from public, anon, authenticated;
grant execute on function public.enforce_offer_write() to service_role;
drop trigger if exists promotions_dashboard_write on promotions;
create trigger promotions_dashboard_write before insert or update or delete on promotions
  for each row execute function public.enforce_offer_write();
drop trigger if exists promotion_items_dashboard_write on promotion_items;
create trigger promotion_items_dashboard_write before insert or update or delete on promotion_items
  for each row execute function public.enforce_offer_write();
drop trigger if exists coupons_dashboard_write on coupons;
create trigger coupons_dashboard_write before insert or update or delete on coupons
  for each row execute function public.enforce_offer_write();

-- The entire copy is invisible until commit; any failed insert rolls it back.
create or replace function public.duplicate_menu_v1(p_restaurant uuid, p_source uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_snapshot jsonb;
  v_source menus%rowtype;
  v_section categories%rowtype;
  v_item menu_items%rowtype;
  v_menu uuid;
  v_id uuid;
  v_name text;
  v_n int := 2;
  v_sections jsonb := '{}'::jsonb;
  v_items jsonb := '{}'::jsonb;
begin
  -- The menu ceiling trigger uses this same lock; competing copies also need
  -- one name each. Read all source rows in one snapshot after taking it.
  select plan_status into v_status from restaurants where id = p_restaurant for no key update;
  if not found then raise exception 'tt_restaurant_missing'; end if;
  if v_status = 'locked' then raise exception 'tt_plan_frozen' using errcode = 'check_violation'; end if;
  select jsonb_build_object(
    'menu', to_jsonb(m),
    'sections', coalesce((select jsonb_agg(c) from categories c where c.menu_id = m.id and c.restaurant_id = p_restaurant), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(i) from menu_items i where i.menu_id = m.id and i.restaurant_id = p_restaurant), '[]'::jsonb),
    'links', coalesce((select jsonb_agg(a) from item_addons a join menu_items i on i.id = a.product_id
      where i.menu_id = m.id and i.restaurant_id = p_restaurant), '[]'::jsonb)
  ) into v_snapshot from menus m where m.id = p_source and m.restaurant_id = p_restaurant;
  if not found then return null; end if;
  v_source := jsonb_populate_record(null::menus, v_snapshot->'menu');
  -- A copied schedule is a newly set schedule, so the browser's feature check
  -- still applies even though this write uses the server key.
  if v_source.schedule is not null and not coalesce((select l.allows_menu_schedules from plan_limits l
      where l.plan = public.effective_restaurant_plan(p_restaurant)), false) then
    raise exception 'tt_plan_feature allows_menu_schedules' using errcode = 'check_violation';
  end if;
  -- Find a free "{name} copy" / "{name} copy 2" ... name.
  v_name := v_source.name || ' copy';
  while exists (select 1 from menus where restaurant_id = p_restaurant and lower(btrim(name)) = lower(btrim(v_name))) loop
    v_name := v_source.name || ' copy ' || v_n;
    v_n := v_n + 1;
  end loop;
  insert into menus (restaurant_id, name, active, schedule, sort_order)
  values (p_restaurant, v_name, false, v_source.schedule,
    (select coalesce(max(sort_order), -1) + 1 from menus where restaurant_id = p_restaurant)) returning id into v_menu;
  -- Sections. Every foreign key is remapped onto a freshly inserted row.
  for v_section in select * from jsonb_populate_recordset(null::categories, v_snapshot->'sections') loop
    insert into categories (restaurant_id, menu_id, name, sort_order, station)
    values (p_restaurant, v_menu, v_section.name, v_section.sort_order, v_section.station) returning id into v_id;
    v_sections := v_sections || jsonb_build_object(v_section.id::text, v_id);
  end loop;
  -- Extras and products use the same explicit fields so neither loses settings.
  -- Physical stock belongs to the original dish: the copy starts uncounted.
  for v_item in select * from jsonb_populate_recordset(null::menu_items, v_snapshot->'items') loop
    insert into menu_items (restaurant_id, menu_id, category_id, name, description, price, emoji, image_url,
      popular, available, is_addon, modifiers, dietary, discount_pct, sort_order, skips_kitchen, stock, stock_auto_off)
    values (p_restaurant, v_menu, (v_sections->>v_item.category_id::text)::uuid, v_item.name, v_item.description,
      v_item.price, v_item.emoji, v_item.image_url, v_item.popular, v_item.available, v_item.is_addon,
      v_item.modifiers, v_item.dietary, v_item.discount_pct, v_item.sort_order, v_item.skips_kitchen, null, false)
    returning id into v_id;
    v_items := v_items || jsonb_build_object(v_item.id::text, v_id);
  end loop;
  -- Products, plus their add-on links. Both sides must belong to this copy.
  insert into item_addons (product_id, addon_id, sort_order)
    select (v_items->>a.product_id::text)::uuid, (v_items->>a.addon_id::text)::uuid, a.sort_order
    from jsonb_populate_recordset(null::item_addons, v_snapshot->'links') a
    where v_items ? a.product_id::text and v_items ? a.addon_id::text;
  -- Publishing is the last write. Nothing is exposed if any earlier step fails.
  update menus set active = v_source.active where id = v_menu;
  return jsonb_build_object('newMenuId', v_menu, 'copyName', v_name);
end $$;
revoke all on function public.duplicate_menu_v1(uuid, uuid) from public, anon, authenticated;
grant execute on function public.duplicate_menu_v1(uuid, uuid) to service_role;

-- S18: keep ingredient history when recipes change, and count at one cutoff.
-- The release delta runs this in one transaction, before the new count caller
-- deploys; no begin/commit here, which would split db:create's single run.
lock table orders, waste_entries, ingredient_purchases, ingredient_counts in share row exclusive mode;

create table if not exists ingredient_consumption (
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  source_kind text not null check (source_kind in ('sale', 'waste', 'purchase')),
  source_id uuid not null,
  usage jsonb not null,
  active boolean not null,
  primary key (source_kind, source_id)
);
create table if not exists ingredient_movements (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  ingredient_id uuid not null,
  quantity numeric not null,
  kind text not null check (kind in ('sale', 'waste', 'purchase')),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists ingredient_movements_stock_idx on ingredient_movements(restaurant_id, ingredient_id, id);
alter table ingredient_consumption enable row level security;
alter table ingredient_movements enable row level security;
revoke all on ingredient_consumption from anon;
revoke all on ingredient_movements from anon;
revoke all on ingredient_consumption, ingredient_movements from public, authenticated;
grant all on ingredient_consumption, ingredient_movements to service_role;
revoke all on sequence ingredient_movements_id_seq from public, anon, authenticated;
grant usage, select on sequence ingredient_movements_id_seq to service_role;
alter table ingredient_counts add column if not exists movement_cutoff bigint;

-- A separate lock name keeps this out of the money and stock-reservation locks.
create or replace function public.lock_ingredient_movements(p_restaurant uuid)
returns void language sql set search_path = public as $$
  select pg_advisory_xact_lock(hashtextextended('ingredient-movements:' || p_restaurant::text, 0));
$$;
revoke all on function public.lock_ingredient_movements(uuid) from public, anon, authenticated;
grant execute on function public.lock_ingredient_movements(uuid) to service_role;

-- Freeze quantities, including combo counts, choices and extras. No recipe
-- version is needed: these are the grams that this particular sale used.
create or replace function public.sale_ingredient_usage(p_restaurant uuid, p_items jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  with lines as (
    select l from jsonb_array_elements(coalesce(p_items, '[]')) l
  ), dishes as (
    select c->>'itemId' as item_id, coalesce(c->'mods', '{}') as choices,
      (c->>'qty')::numeric * (l->>'qty')::numeric as quantity
      from lines cross join lateral jsonb_array_elements(coalesce(l->'components', '[]')) c
    union all
    select l->>'itemId', coalesce(l->'mods', '{}'), (l->>'qty')::numeric from lines
      where jsonb_array_length(coalesce(l->'components', '[]')) = 0
    union all
    select e->>'id', '{}'::jsonb, (l->>'qty')::numeric
      from lines cross join lateral jsonb_array_elements(coalesce(l->'extras', '[]')) e
  ), used as (
    select r.ingredient_id, -sum(r.quantity * d.quantity) as quantity
      from dishes d join recipe_lines r on r.item_id::text = d.item_id and r.restaurant_id = p_restaurant
      where r.mod_label is null or d.choices->r.mod_label = to_jsonb(r.mod_option)
        or (jsonb_typeof(d.choices->r.mod_label) = 'array' and (d.choices->r.mod_label) ? r.mod_option)
      group by r.ingredient_id
  ) select coalesce(jsonb_object_agg(ingredient_id, quantity), '{}') from used;
$$;
revoke all on function public.sale_ingredient_usage(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sale_ingredient_usage(uuid, jsonb) to service_role;

create or replace function public.waste_ingredient_usage(p_restaurant uuid, p_ingredient uuid, p_item uuid, p_quantity numeric)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when p_ingredient is not null then jsonb_build_object(p_ingredient, -p_quantity)
    else public.sale_ingredient_usage(p_restaurant, jsonb_build_array(jsonb_build_object(
      'itemId', p_item, 'qty', p_quantity, 'mods', coalesce((
        select jsonb_object_agg(m->>'label', m->'options'->0)
          from menu_items i cross join lateral jsonb_array_elements(coalesce(i.modifiers, '[]')) m
          where i.id = p_item and i.restaurant_id = p_restaurant and m->>'type' = 'single'
            and jsonb_array_length(m->'options') > 0
      ), '{}')))) end;
$$;
revoke all on function public.waste_ingredient_usage(uuid, uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.waste_ingredient_usage(uuid, uuid, uuid, numeric) to service_role;

-- Existing recipes cannot tell us what an older, already edited recipe was.
-- Freeze the best evidence left at upgrade, once; never recalculate it later.
with added as (
  insert into ingredient_consumption(restaurant_id, source_kind, source_id, usage, active)
    select restaurant_id, 'sale', id, public.sale_ingredient_usage(restaurant_id, items),
      status in ('received', 'preparing', 'ready', 'completed') from orders
    on conflict do nothing returning *
) insert into ingredient_movements(restaurant_id, ingredient_id, quantity, kind, created_at)
  select a.restaurant_id, u.key::uuid, u.value::numeric, a.source_kind, o.created_at
    from added a join orders o on o.id = a.source_id cross join lateral jsonb_each_text(a.usage) u where a.active;
with added as (
  insert into ingredient_consumption(restaurant_id, source_kind, source_id, usage, active)
    select restaurant_id, 'waste', id, public.waste_ingredient_usage(restaurant_id, ingredient_id, item_id, quantity), true from waste_entries
    on conflict do nothing returning *
) insert into ingredient_movements(restaurant_id, ingredient_id, quantity, kind, created_at)
  select a.restaurant_id, u.key::uuid, u.value::numeric, a.source_kind, w.created_at
    from added a join waste_entries w on w.id = a.source_id cross join lateral jsonb_each_text(a.usage) u;
with added as (
  insert into ingredient_consumption(restaurant_id, source_kind, source_id, usage, active)
    select restaurant_id, 'purchase', id, jsonb_build_object(ingredient_id, quantity), true from ingredient_purchases
    on conflict do nothing returning *
) insert into ingredient_movements(restaurant_id, ingredient_id, quantity, kind, created_at)
  select a.restaurant_id, u.key::uuid, u.value::numeric, a.source_kind, p.created_at
    from added a join ingredient_purchases p on p.id = a.source_id cross join lateral jsonb_each_text(a.usage) u;

-- Keep the old callers: every write, including waste taken back and a pending
-- checkout becoming food, records its delta under the same count lock.
create or replace function public.track_ingredient_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_restaurant uuid := (v_row->>'restaurant_id')::uuid;
  v_kind text := case tg_table_name when 'orders' then 'sale' when 'waste_entries' then 'waste' else 'purchase' end;
  v_previous ingredient_consumption;
  v_usage jsonb;
  v_active boolean := tg_op <> 'DELETE';
  v_changed boolean := false;
begin
  if tg_op = 'UPDATE' and new.restaurant_id is distinct from old.restaurant_id then
    raise exception 'ingredient history belongs to one restaurant';
  end if;
  -- An update that changes neither what a row used nor whether it counts moves
  -- no ingredient, so it takes no lock. Otherwise the kitchen walking an order
  -- from preparing to ready queues behind a count, and can deadlock a payment
  -- that writes two orders: each would hold what the other one waits for.
  if tg_op = 'UPDATE' then
    if v_kind = 'sale' then
      v_changed := new.items is distinct from old.items;
      if not v_changed and (new.status in ('received', 'preparing', 'ready', 'completed'))
          is not distinct from (old.status in ('received', 'preparing', 'ready', 'completed')) then
        return null;
      end if;
    elsif v_kind = 'waste' then
      v_changed := (new.ingredient_id, new.item_id, new.quantity) is distinct from (old.ingredient_id, old.item_id, old.quantity);
      if not v_changed then return null; end if;
    else
      v_changed := (new.ingredient_id, new.quantity) is distinct from (old.ingredient_id, old.quantity);
      if not v_changed then return null; end if;
    end if;
  end if;
  -- A restaurant deletion already removes both books by cascade.
  if not exists(select 1 from restaurants where id = v_restaurant) then return null; end if;
  perform public.lock_ingredient_movements(v_restaurant);
  select * into v_previous from ingredient_consumption where source_kind = v_kind and source_id = (v_row->>'id')::uuid;
  v_usage := v_previous.usage;
  if v_usage is null or v_changed then
    if v_kind = 'sale' then v_usage := public.sale_ingredient_usage(v_restaurant, v_row->'items');
    elsif v_kind = 'waste' then v_usage := public.waste_ingredient_usage(v_restaurant,
      (v_row->>'ingredient_id')::uuid, (v_row->>'item_id')::uuid, (v_row->>'quantity')::numeric);
    else v_usage := jsonb_build_object(v_row->>'ingredient_id', (v_row->>'quantity')::numeric); end if;
  end if;
  if v_kind = 'sale' then v_active := v_active and v_row->>'status' in ('received', 'preparing', 'ready', 'completed'); end if;
  insert into ingredient_movements(restaurant_id, ingredient_id, quantity, kind, created_at)
    select v_restaurant, key::uuid, sum(quantity), v_kind,
      case when tg_op = 'INSERT' then (v_row->>'created_at')::timestamptz else clock_timestamp() end from (
      select key, value::numeric as quantity from jsonb_each_text(v_usage) where v_active
      union all
      select key, -value::numeric from jsonb_each_text(coalesce(v_previous.usage, '{}')) where coalesce(v_previous.active, false)
    ) delta group by key having sum(quantity) <> 0;
  insert into ingredient_consumption(restaurant_id, source_kind, source_id, usage, active)
    values(v_restaurant, v_kind, (v_row->>'id')::uuid, v_usage, v_active)
    on conflict (source_kind, source_id) do update set usage = excluded.usage, active = excluded.active;
  return null;
end;
$$;
revoke all on function public.track_ingredient_movement() from public, anon, authenticated;
drop trigger if exists track_ingredient_movement on orders;
create trigger track_ingredient_movement after insert or update or delete on orders for each row execute function public.track_ingredient_movement();
drop trigger if exists track_ingredient_movement on waste_entries;
create trigger track_ingredient_movement after insert or update or delete on waste_entries for each row execute function public.track_ingredient_movement();
drop trigger if exists track_ingredient_movement on ingredient_purchases;
create trigger track_ingredient_movement after insert or update or delete on ingredient_purchases for each row execute function public.track_ingredient_movement();

-- Counts never lock an order or a menu item. Take the movement lock before
-- the purchase's ingredient row lock too, so its FK cannot deadlock a count.
create or replace function public.record_purchase(
  p_restaurant uuid, p_ingredient uuid, p_packs numeric, p_total numeric, p_actor text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_ingredient ingredients%rowtype;
  v_pack_price numeric;
  v_id uuid;
begin
  perform public.lock_ingredient_movements(p_restaurant);
  if p_packs <= 0 then return null; end if;
  select * into v_ingredient from ingredients
   where id = p_ingredient and restaurant_id = p_restaurant and archived_at is null for update;
  if v_ingredient.id is null then return null; end if;
  v_pack_price := round(p_total / p_packs, 2);
  if v_pack_price is distinct from v_ingredient.pack_price then
    update ingredients set pack_price = v_pack_price, updated_by = p_actor where id = p_ingredient;
  end if;
  insert into ingredient_purchases (restaurant_id, ingredient_id, quantity, total, recorded_by)
  values (p_restaurant, p_ingredient, p_packs * v_ingredient.pack_size, p_total, p_actor)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.record_purchase(uuid, uuid, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.record_purchase(uuid, uuid, numeric, numeric, text) to service_role;

-- This also protects the deployed caller that still inserts count rows.
create or replace function public.cutoff_ingredient_count()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_last ingredient_counts;
begin
  perform public.lock_ingredient_movements(new.restaurant_id);
  select * into v_last from ingredient_counts where restaurant_id = new.restaurant_id and ingredient_id = new.ingredient_id
    order by movement_cutoff desc nulls last, created_at desc, id desc limit 1;
  new.movement_cutoff := nextval('public.ingredient_movements_id_seq');
  new.created_at := clock_timestamp();
  new.expected := null;
  if v_last.id is not null then
    select v_last.counted + coalesce(sum(quantity), 0) into new.expected from ingredient_movements
      where restaurant_id = new.restaurant_id and ingredient_id = new.ingredient_id
        and id <= new.movement_cutoff and case when v_last.movement_cutoff is null then created_at > v_last.created_at
          else id > v_last.movement_cutoff end;
  end if;
  return new;
end;
$$;
revoke all on function public.cutoff_ingredient_count() from public, anon, authenticated;
drop trigger if exists cutoff_ingredient_count on ingredient_counts;
create trigger cutoff_ingredient_count before insert on ingredient_counts for each row execute function public.cutoff_ingredient_count();

create or replace function public.record_ingredient_counts(p_restaurant uuid, p_counts jsonb, p_actor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_results jsonb;
begin
  perform public.lock_ingredient_movements(p_restaurant);
  if jsonb_typeof(p_counts) is distinct from 'array' then raise exception 'invalid counts'; end if;
  if jsonb_array_length(p_counts) not between 1 and 500 or exists (
    select 1 from jsonb_to_recordset(p_counts) as c(ingredient_id uuid, counted numeric)
      where ingredient_id is null or counted is null or counted < 0 or counted > 10000000
        or counted::text in ('NaN', 'Infinity', '-Infinity') or counted <> round(counted, 3)
  ) or (select count(distinct c->>'ingredient_id') from jsonb_array_elements(p_counts) c) <> jsonb_array_length(p_counts) then
    raise exception 'invalid counts';
  end if;
  if exists(select 1 from jsonb_to_recordset(p_counts) as c(ingredient_id uuid) where not exists(
    select 1 from ingredients i where i.id = c.ingredient_id and i.restaurant_id = p_restaurant and i.archived_at is null
  )) then return null; end if;
  with recorded as (
    insert into ingredient_counts(restaurant_id, ingredient_id, counted, counted_by)
      select p_restaurant, c.ingredient_id, c.counted, p_actor
        from jsonb_to_recordset(p_counts) as c(ingredient_id uuid, counted numeric)
      returning ingredient_id, counted, expected
  ) select jsonb_agg(to_jsonb(recorded)) into v_results from recorded;
  return v_results;
end;
$$;
revoke all on function public.record_ingredient_counts(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_ingredient_counts(uuid, jsonb, text) to service_role;
revoke truncate, references, trigger on all tables in schema public from authenticated;
revoke truncate, references, trigger on all tables in schema public from public, anon, authenticated;

-- S9: the drawer keeps the currency it opened in. Old rows have no evidence
-- of the float's original currency; receipts alone cannot prove it. Use the
-- restaurant's currency today for those rows, rather than invent a history.
alter table cash_shifts add column if not exists currency text;
update cash_shifts s set currency = r.currency from restaurants r
  where r.id = s.restaurant_id and s.currency is null;
alter table cash_shifts alter column currency set not null;
alter table cash_movements add column if not exists currency text;
update cash_movements m set currency = s.currency from cash_shifts s
  where s.id = m.shift_id and s.restaurant_id = m.restaurant_id and m.currency is null;
update cash_movements m set currency = r.currency from restaurants r
  where r.id = m.restaurant_id and m.currency is null;
alter table cash_movements alter column currency set not null;

-- Fill omitted currencies so the deployed routes still work before the new
-- routes ship. A menu currency change never relabels an existing drawer.
create or replace function public.freeze_cash_currency()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.currency is distinct from old.currency or new.restaurant_id is distinct from old.restaurant_id then
      raise exception 'drawer currency is immutable';
    end if;
    if tg_table_name = 'cash_movements' then
      if new.shift_id is distinct from old.shift_id then raise exception 'withdrawal shift is immutable'; end if;
    end if;
    return new;
  end if;
  if tg_table_name = 'cash_movements' then
    if new.shift_id is not null then
      select currency into new.currency from cash_shifts
        where id = new.shift_id and restaurant_id = new.restaurant_id;
      if not found then raise exception 'withdrawal shift not found'; end if;
      return new;
    end if;
  end if;
  select currency into new.currency from restaurants where id = new.restaurant_id;
  return new;
end;
$$;
revoke all on function public.freeze_cash_currency() from public, anon, authenticated;
grant execute on function public.freeze_cash_currency() to service_role;
drop trigger if exists freeze_cash_currency on cash_shifts;
create trigger freeze_cash_currency before insert or update on cash_shifts
  for each row execute function public.freeze_cash_currency();
drop trigger if exists freeze_cash_currency on cash_movements;
create trigger freeze_cash_currency before insert or update on cash_movements
  for each row execute function public.freeze_cash_currency();

-- One calculation for both the signed close and the later review. Aggregate
-- inside Postgres: PostgREST's row cap must never cut a busy shift short.
create or replace function public.cash_shift_totals(p_restaurant uuid, p_shift uuid, p_until timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with s as (
    select *, least(coalesce(closed_at, p_until), p_until) until_at
      from cash_shifts where id = p_shift and restaurant_id = p_restaurant
  ), receipts as (
    select coalesce(sum(p.amount), 0) amount from payments p, s
      where p.restaurant_id = p_restaurant and p.currency = s.currency
        and p.method = 'cash' and nullif(p.actor_email, '') is not null
        and p.created_at between s.opened_at and s.until_at
  ), returns as (
    select coalesce(sum(f.amount), 0) amount from refund_operations f, s
      where f.restaurant_id = p_restaurant and f.currency = s.currency
        and f.status = 'succeeded' and f.source = 'cash' and nullif(f.payout_actor, '') is not null
        and f.completed_at between s.opened_at and s.until_at
  ), old_returns as (
    -- Imported returns are counted above once. Older logs without a currency
    -- use their uniquely named order's currency, or the drawer's fallback.
    select coalesce(sum(substring(l.detail from '(?:^| )amount=([0-9]+(?:[.][0-9]+)?)(?: |$)')::numeric), 0) amount
      from user_logs l cross join s
      where l.restaurant_id = p_restaurant and l.action = 'refunded'
        and l.created_at between s.opened_at and s.until_at
        and substring(l.detail from '(?:^| )method=([^ ]+)') = 'cash'
        and nullif(substring(l.detail from '(?:^| )collector=([^ ]+)'), '') is not null
        and not exists(select 1 from refund_operations f where f.restaurant_id = p_restaurant and f.historical_log_id = l.id)
        and coalesce(substring(l.detail from '(?:^| )currency=([^ ]+)'),
          (select case when count(*) = 1 then min(o.currency) end from orders o
            where o.restaurant_id = p_restaurant
              and left(o.id::text, 8) = substring(l.detail from '(?:^| )order=([^ ]+)')), s.currency) = s.currency
  ), withdrawals as (
    select coalesce(sum(m.amount), 0) amount from cash_movements m, s
      where m.restaurant_id = p_restaurant and m.shift_id = s.id
        and m.kind = 'withdrawal' and m.currency = s.currency
  )
  select jsonb_build_object('opening', round(s.opening_amount, 2),
    'cashSales', round(r.amount - f.amount - h.amount, 2), 'withdrawn', round(w.amount, 2),
    'expected', round(s.opening_amount + r.amount - f.amount - h.amount - w.amount, 2))
    from s cross join receipts r cross join returns f cross join old_returns h cross join withdrawals w;
$$;
revoke all on function public.cash_shift_totals(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.cash_shift_totals(uuid, uuid, timestamptz) to service_role;

create or replace function public.close_cash_shift(p_restaurant uuid, p_shift uuid, p_counted numeric, p_actor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s cash_shifts; v_at timestamptz; v_sum jsonb; v_difference numeric;
begin
  perform public.lock_restaurant_money(p_restaurant);
  select * into s from cash_shifts where restaurant_id = p_restaurant and id = p_shift and closed_at is null for update;
  if not found then return null; end if;
  if p_counted is null or p_counted < 0 or p_counted > 1000000 or p_counted <> round(p_counted, 2)
    or nullif(btrim(p_actor), '') is null then raise exception 'invalid cash count'; end if;
  -- now() is the transaction's start, possibly before waiting for the lock.
  -- The count includes every earlier writer, so date it after that wait.
  v_at := clock_timestamp();
  v_sum := public.cash_shift_totals(p_restaurant, p_shift, v_at);
  v_difference := round(p_counted - (v_sum->>'expected')::numeric, 2);
  update cash_shifts set closed_at = v_at, closed_by = p_actor, counted_cash = p_counted,
    expected_cash = (v_sum->>'expected')::numeric, difference = v_difference where id = s.id;
  return v_sum || jsonb_build_object('id', s.id, 'currency', s.currency, 'counted', p_counted, 'difference', v_difference);
end;
$$;
revoke all on function public.close_cash_shift(uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.close_cash_shift(uuid, uuid, numeric, text) to service_role;

create or replace function public.create_cash_withdrawal(p_restaurant uuid, p_shift uuid, p_amount numeric, p_note text, p_actor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s cash_shifts; v_id uuid;
begin
  perform public.lock_restaurant_money(p_restaurant);
  select * into s from cash_shifts where restaurant_id = p_restaurant and id = p_shift and closed_at is null for update;
  if not found then return null; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 or p_amount <> round(p_amount, 2)
    or nullif(btrim(p_actor), '') is null then raise exception 'invalid cash withdrawal'; end if;
  insert into cash_movements(restaurant_id, shift_id, currency, kind, amount, note, actor_email, created_at)
    values(p_restaurant, s.id, s.currency, 'withdrawal', p_amount, p_note, p_actor, clock_timestamp()) returning id into v_id;
  return jsonb_build_object('id', v_id, 'currency', s.currency);
end;
$$;
revoke all on function public.create_cash_withdrawal(uuid, uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function public.create_cash_withdrawal(uuid, uuid, numeric, text, text) to service_role;

create or replace function public.delete_cash_withdrawal(p_restaurant uuid, p_shift uuid, p_movement uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s cash_shifts; m cash_movements;
begin
  perform public.lock_restaurant_money(p_restaurant);
  select * into s from cash_shifts where restaurant_id = p_restaurant and id = p_shift and closed_at is null for update;
  if not found then return null; end if;
  delete from cash_movements where restaurant_id = p_restaurant and shift_id = s.id and id = p_movement and kind = 'withdrawal'
    returning * into m;
  if not found then return null; end if;
  return jsonb_build_object('amount', m.amount, 'note', m.note, 'currency', m.currency);
end;
$$;
revoke all on function public.delete_cash_withdrawal(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_cash_withdrawal(uuid, uuid, uuid) to service_role;

-- A shift can belong to today's handover even if it opened yesterday, or its
-- count was corrected by a receipt that arrived today with an earlier date.
create or replace function public.cash_shifts_for_day(p_restaurant uuid, p_day_start timestamptz)
returns setof public.cash_shifts language sql stable security definer set search_path = public as $$
  select s.* from cash_shifts s where s.restaurant_id = p_restaurant and (
    s.opened_at >= p_day_start or s.closed_at >= p_day_start or s.closed_at is null
    or exists(select 1 from payments p where p.restaurant_id = p_restaurant and p.currency = s.currency
      and p.method = 'cash' and nullif(p.actor_email, '') is not null
      and p.recorded_at >= p_day_start and p.recorded_at > s.closed_at
      and p.created_at between s.opened_at and s.closed_at)
  ) order by s.opened_at, s.id;
$$;
revoke all on function public.cash_shifts_for_day(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.cash_shifts_for_day(uuid, timestamptz) to service_role;
create index if not exists cash_shifts_closed_idx on cash_shifts(restaurant_id, closed_at) where closed_at is not null;
create index if not exists payments_cash_recorded_idx on payments(restaurant_id, recorded_at, created_at)
  where method = 'cash' and actor_email is not null;

-- Exact membership is the cutoff: transaction timestamps can predate a waited lock.
-- Old marks keep null manifests and their deployed timestamp interpretation.
alter table public.terminal_deposits add column if not exists snapshot_at timestamptz;
alter table public.terminal_deposits add column if not exists payment_ids uuid[];
alter table public.terminal_deposits add column if not exists return_ids text[];
alter table public.terminal_deposits add column if not exists fee_pct numeric;

-- Allocation dates distinguish a same-day void (fee reversed) from a later refund.
create or replace function public.terminal_deposit_ledger_v1(p_restaurant uuid, p_currency text)
returns table(id text, payment_id uuid, amount numeric, tip numeric, created_at timestamptz,
  recorded_at timestamptz, voided_at timestamptz, returned_at timestamptz, order_id uuid, terminal_ref text)
language sql stable security definer set search_path = public as $$
  select p.id::text, p.id, p.amount,
    case when p.tip > 0 then p.tip when abs(o.total - p.amount) < 0.005 then coalesce(o.tip, 0) else 0 end,
    p.created_at, p.recorded_at,
    case when p.allocation_origin = 'legacy' and o.status = 'cancelled'
      and not exists(select 1 from order_adjustments a where a.restaurant_id = p_restaurant and a.order_id = p.order_id)
      then coalesce(o.cancelled_at, p.created_at) end,
    null::timestamptz, p.order_id, p.terminal_ref
  from payments p left join orders o on o.id = p.order_id and o.restaurant_id = p_restaurant
  where p.restaurant_id = p_restaurant and p.currency = p_currency and p.method = 'card' and p.stripe_payment_intent is null
  union all
  select 'return:' || ra.id, p.id, ra.amount, ra.tip, p.created_at, r.completed_at,
    null::timestamptz, r.completed_at, p.order_id, p.terminal_ref
  from refund_operations r
  join refund_allocations ra on ra.operation_id = r.id and ra.restaurant_id = p_restaurant
  join payment_allocations pa on pa.id = ra.allocation_id and pa.restaurant_id = p_restaurant
  join payments p on p.id = pa.payment_id and p.restaurant_id = p_restaurant
  where r.restaurant_id = p_restaurant and r.currency = p_currency and r.source = 'terminal'
    and r.status = 'succeeded' and r.completed_at is not null
    and p.currency = p_currency and p.method = 'card' and p.stripe_payment_intent is null;
$$;
revoke all on function public.terminal_deposit_ledger_v1(uuid, text) from public, anon, authenticated;
grant execute on function public.terminal_deposit_ledger_v1(uuid, text) to service_role;

create or replace function public.record_terminal_deposit_v1(
  p_restaurant uuid, p_day date, p_currency text, p_received numeric, p_note text, p_actor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_zone text; v_fee numeric; v_expected numeric; v_payments uuid[]; v_returns text[]; v_has_sales boolean;
begin
  perform public.lock_restaurant_money(p_restaurant);
  select coalesce(timezone, 'America/Mexico_City'), terminal_fee_pct into v_zone, v_fee
    from restaurants where id = p_restaurant for share;
  if not found or p_day is null or p_currency not in ('MXN', 'USD') or p_received is null
    or p_received < 0 or p_received <> round(p_received, 2) then raise exception 'invalid deposit'; end if;
  if exists(select 1 from terminal_deposits where restaurant_id = p_restaurant and sales_day = p_day and currency = p_currency) then
    return jsonb_build_object('error', 'marked');
  end if;
  with ledger as materialized (
    select *, (created_at at time zone v_zone)::date sale_day
    from public.terminal_deposit_ledger_v1(p_restaurant, p_currency)
  ), marks as materialized (
    select * from terminal_deposits where restaurant_id = p_restaurant and currency = p_currency
  ), returns as (
    select id, payment_id, amount, sale_day, returned_at at_time, (returned_at at time zone v_zone)::date as day
      from ledger where returned_at is not null
    union all
    select 'void:' || id, payment_id, amount, sale_day, voided_at, (voided_at at time zone v_zone)::date
      from ledger where returned_at is null and voided_at is not null
  ), receipts as (
    select l.*, l.amount - coalesce((select sum(r.amount) from returns r
      where r.payment_id = l.payment_id and r.day = l.sale_day
        and not exists(select 1 from marks d where d.sales_day = l.sale_day)), 0) net
    from ledger l where l.returned_at is null
  ), sales as (
    select distinct sale_day as day from receipts where net > 0
  ), assigned as (
    select r.*,
      r.sale_day = r.day and not exists(select 1 from marks d where d.sales_day = r.sale_day) same_day,
      (select d.sales_day from marks d where r.id = any(d.return_ids)
        or (d.return_ids is null and r.at_time <= d.created_at
          and d.sales_day = (select min(s.day) from sales s where s.day >= r.day)) order by (d.return_ids is not null) desc limit 1) consumed,
      (select min(s.day) from sales s where s.day >= r.day and not exists(select 1 from marks d where d.sales_day = s.day)) target,
      case when r.sale_day = r.day then r.amount - round(r.amount * coalesce(
        (select d.fee_pct from marks d where d.sales_day = r.sale_day), v_fee) / 100, 2) else r.amount end debit
    from returns r
  )
  select coalesce((select sum(net) - round(sum(net) * v_fee / 100, 2) from receipts where sale_day = p_day), 0)
      - coalesce((select sum(debit) from assigned where not same_day and consumed is null and target = p_day), 0),
    coalesce((select array_agg(payment_id order by payment_id) from receipts where sale_day = p_day), '{}'::uuid[]),
    coalesce((select array_agg(id order by id) from assigned where consumed is null
      and ((same_day and sale_day = p_day) or (not same_day and target = p_day))), '{}'::text[]),
    exists(select 1 from receipts where sale_day = p_day and net > 0)
  into v_expected, v_payments, v_returns, v_has_sales;
  if not v_has_sales then return jsonb_build_object('error', 'no_sales'); end if;
  -- Calculate and insert before releasing the settlement lock. A later receipt
  -- is outside payment_ids even if its recorded_at was set before it waited.
  insert into terminal_deposits(restaurant_id, sales_day, currency, expected, received, note, recorded_by,
    snapshot_at, payment_ids, return_ids, fee_pct)
  values(p_restaurant, p_day, p_currency, v_expected, p_received, p_note, p_actor,
    clock_timestamp(), v_payments, v_returns, v_fee);
  return jsonb_build_object('expected', v_expected);
end;
$$;
revoke all on function public.record_terminal_deposit_v1(uuid, date, text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.record_terminal_deposit_v1(uuid, date, text, numeric, text, text) to service_role;

-- Taking back a mark releases its returns to another deposit under the same lock.
create or replace function public.delete_terminal_deposit_v1(p_restaurant uuid, p_day date, p_currency text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform public.lock_restaurant_money(p_restaurant);
  delete from terminal_deposits where restaurant_id = p_restaurant and sales_day = p_day and currency = p_currency;
  return found;
end;
$$;
revoke all on function public.delete_terminal_deposit_v1(uuid, date, text) from public, anon, authenticated;
grant execute on function public.delete_terminal_deposit_v1(uuid, date, text) to service_role;

-- Stock movements keep their generation; a new physical count supersedes it.
-- Each trusted function sets tabletap.stock_movement itself (set_config, for
-- its transaction): Supabase refuses a custom setting attached with ALTER
-- FUNCTION ... SET.

-- The count is authoritative. Holds from before it remain recorded, but their
-- dish generation no longer matches: neither expiry nor cancellation can add
-- them to this new count. Other dishes in the same reservation still return.
create or replace function public.recount_stock(
  p_restaurant uuid, p_item uuid, p_stock int, p_expected_stock int, p_expected_epoch int
) returns text language plpgsql security definer set search_path = public as $$
declare v_item menu_items%rowtype;
begin
  -- A recount starts a new generation (set for its transaction: Supabase
  -- refuses a custom setting attached with ALTER FUNCTION ... SET).
  perform set_config('tabletap.stock_recount', 'on', true);
  if p_stock < 0 or p_expected_epoch is null or p_expected_epoch < 0 then
    raise exception 'Invalid stock count';
  end if;
  select * into v_item from menu_items
    where id = p_item and restaurant_id = p_restaurant and not is_addon for update;
  if not found then return 'missing'; end if;
  if v_item.stock is distinct from p_expected_stock
     or v_item.stock_epoch is distinct from p_expected_epoch then
    return 'changed';
  end if;
  update menu_items set stock = p_stock, stock_epoch = stock_epoch + 1,
    available = case when p_stock = 0 then false
      when stock_auto_off then true else available end,
    stock_auto_off = case when p_stock = 0 then available or stock_auto_off else false end
    where id = p_item and restaurant_id = p_restaurant;
  return 'counted';
end;
$$;
revoke all on function public.recount_stock(uuid, uuid, int, int, int) from public, anon, authenticated;
grant execute on function public.recount_stock(uuid, uuid, int, int, int) to service_role;

-- S20: one reference belongs to one intent. Null keeps deployed writers working.
alter table orders add column if not exists request_ref uuid;
alter table orders add column if not exists request_scope text;
create unique index if not exists orders_request_once on orders(restaurant_id, request_ref) where request_ref is not null;
alter table cash_movements add column if not exists request_ref uuid;
create unique index if not exists cash_movements_request_once on cash_movements(shift_id, request_ref) where request_ref is not null;
alter table ingredient_purchases add column if not exists request_ref uuid;
alter table ingredient_purchases add column if not exists request_packs numeric;
create unique index if not exists ingredient_purchases_request_once on ingredient_purchases(restaurant_id, request_ref) where request_ref is not null;
alter table waste_entries add column if not exists request_ref uuid;
create unique index if not exists waste_entries_request_once on waste_entries(restaurant_id, request_ref) where request_ref is not null;
alter table ingredient_counts add column if not exists request_ref uuid;
create unique index if not exists ingredient_counts_request_once on ingredient_counts(restaurant_id, request_ref, ingredient_id) where request_ref is not null;
alter table cash_shifts add column if not exists close_ref uuid;
alter table cash_shifts add column if not exists close_result jsonb;
create unique index if not exists cash_shifts_close_once on cash_shifts(restaurant_id, close_ref) where close_ref is not null;

create or replace function public.order_intent_result(p_restaurant uuid, p_ref uuid, p_scope text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where restaurant_id = p_restaurant and request_ref = p_ref;
  if not found then return null; end if;
  if o.request_scope is distinct from p_scope then return '{"conflict":true}'::jsonb; end if;
  return jsonb_build_object('orderId', o.id, 'sessionId', o.session_id, 'table', o.table_label, 'total', o.total, 'repeat', true);
end;
$$;
revoke all on function public.order_intent_result(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.order_intent_result(uuid, uuid, text) to service_role;

create or replace function public.create_order_intent(
  p_restaurant uuid, p_ref uuid, p_scope text, p_order jsonb, p_demand jsonb,
  p_inventory boolean, p_threshold int, p_coupon jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb; v_stock jsonb; v_reservation uuid; v_id uuid; v_coupon coupons;
begin
  perform public.lock_restaurant_money(p_restaurant);
  perform pg_advisory_xact_lock(hashtextextended(p_restaurant::text || p_ref::text, 20));
  v_result := public.order_intent_result(p_restaurant, p_ref, p_scope);
  if v_result is not null then return v_result; end if;
  if p_ref is null or nullif(p_scope, '') is null then raise exception 'missing order reference'; end if;
  -- Stock and coupon failures roll each other back, along with the ticket.
  begin
    if p_inventory then
      v_reservation := gen_random_uuid();
      v_stock := public.reserve_stock(p_restaurant, p_demand, p_threshold, v_reservation);
      if not (v_stock->>'ok')::boolean then return v_stock; end if;
    end if;
    if p_coupon is not null then
      select * into v_coupon from coupons where id = (p_coupon->>'id')::uuid and restaurant_id = p_restaurant for update;
      -- Judged on the subtotal before the coupon, as the route judged it.
      if not found or v_coupon.staff_only
        or v_coupon.min_subtotal > coalesce((p_coupon->>'eligible_subtotal')::numeric, (p_order->>'subtotal')::numeric)
        or (v_coupon.kind, v_coupon.value, v_coupon.code) is distinct from
           (p_coupon->>'kind', (p_coupon->>'value')::numeric, p_coupon->>'code')
        or public.redeem_coupon(v_coupon.id) is null then
        raise exception using errcode = 'PT020', message = 'coupon unavailable';
      end if;
    end if;
    insert into orders(restaurant_id, request_ref, request_scope, table_id, table_label, session_id, diner,
      stock_managed, stock_reservation_id, status, paid, subtotal, service_fee, tip, tax_pct,
      discount, platform_fee, coupon_code, promo_detail, total, currency, items, note, customer_name)
    values(p_restaurant, p_ref, p_scope, (p_order->>'table_id')::uuid, p_order->>'table_label',
      (p_order->>'session_id')::uuid, p_order->>'diner', true, v_reservation, 'received', false,
      (p_order->>'subtotal')::numeric, (p_order->>'service_fee')::numeric, (p_order->>'tip')::numeric,
      (p_order->>'tax_pct')::numeric, (p_order->>'discount')::numeric, 0, p_order->>'coupon_code',
      p_order->'promo_detail', (p_order->>'total')::numeric, p_order->>'currency', p_order->'items',
      p_order->>'note', p_order->>'customer_name')
    on conflict (restaurant_id, request_ref) where request_ref is not null do nothing returning id into v_id;
    if v_id is null then
      -- Roll back this attempt's reservations before returning the winner.
      raise exception using errcode = 'PT021', message = 'order already recorded';
    end if;
    if p_coupon is not null then
      insert into coupon_redemptions(restaurant_id, coupon_id, order_id, code, amount, confirmed_at)
      -- promo_detail is null when the cart's discount is 0, and the amount is
      -- required: recorded as 0, as logCheckoutCoupon records it.
      values(p_restaurant, v_coupon.id, v_id, v_coupon.code, coalesce((p_order->'promo_detail'->>'coupon')::numeric, 0), clock_timestamp());
    end if;
  exception when sqlstate 'PT020' then return '{"couponReason":"limitReached"}'::jsonb;
    when sqlstate 'PT021' then return public.order_intent_result(p_restaurant, p_ref, p_scope);
  end;
  return (public.order_intent_result(p_restaurant, p_ref, p_scope) - 'repeat') || jsonb_build_object('low', coalesce(v_stock->'low', '[]'::jsonb));
end;
$$;
revoke all on function public.create_order_intent(uuid, uuid, text, jsonb, jsonb, boolean, int, jsonb) from public, anon, authenticated;
grant execute on function public.create_order_intent(uuid, uuid, text, jsonb, jsonb, boolean, int, jsonb) to service_role;

create or replace function public.create_cash_withdrawal_once(
  p_restaurant uuid, p_shift uuid, p_amount numeric, p_note text, p_actor text, p_ref uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare s cash_shifts; m cash_movements;
begin
  perform public.lock_restaurant_money(p_restaurant);
  select * into m from cash_movements where restaurant_id = p_restaurant and request_ref = p_ref;
  if found then
    if (m.shift_id, m.amount, m.note) is distinct from (p_shift, p_amount, p_note) then
      raise exception 'reference belongs to another withdrawal' using errcode = 'PT409';
    end if;
    return jsonb_build_object('id', m.id, 'currency', m.currency);
  end if;
  select * into s from cash_shifts where restaurant_id = p_restaurant and id = p_shift and closed_at is null for update;
  if not found then return null; end if;
  if p_ref is null or p_amount is null or p_amount <= 0 or p_amount > 1000000 or p_amount <> round(p_amount, 2)
    or nullif(btrim(p_actor), '') is null then raise exception 'invalid cash withdrawal'; end if;
  insert into cash_movements(restaurant_id, shift_id, request_ref, currency, kind, amount, note, actor_email, created_at)
    values(p_restaurant, s.id, p_ref, s.currency, 'withdrawal', p_amount, p_note, p_actor, clock_timestamp())
    on conflict (shift_id, request_ref) where request_ref is not null do nothing returning * into m;
  if m.id is null then raise exception 'withdrawal reference changed' using errcode = 'PT409'; end if;
  return jsonb_build_object('id', m.id, 'currency', m.currency);
end;
$$;
revoke all on function public.create_cash_withdrawal_once(uuid, uuid, numeric, text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_cash_withdrawal_once(uuid, uuid, numeric, text, text, uuid) to service_role;

create or replace function public.record_purchase_once(
  p_restaurant uuid, p_ingredient uuid, p_packs numeric, p_total numeric, p_actor text, p_ref uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare i ingredients; p ingredient_purchases; v_id uuid; v_price numeric;
begin
  perform public.lock_ingredient_movements(p_restaurant);
  select * into p from ingredient_purchases where restaurant_id = p_restaurant and request_ref = p_ref;
  -- Old receipts did not save packs, so those match on ingredient and money.
  -- Never on packs times today's pack size, which may have changed; and never
  -- refused outright, because the clients in production forget a reference
  -- on a 409 and the next send recorded the MX$100 a second time.
  if found and (p.ingredient_id is distinct from p_ingredient or p.total is distinct from p_total
    or (p.request_packs is not null and p.request_packs is distinct from p_packs)) then
    raise exception 'reference belongs to another purchase' using errcode = 'PT409';
  end if;
  if found then return p.id; end if;
  if p_ref is null or p_packs <= 0 then return null; end if;
  select * into i from ingredients where id = p_ingredient and restaurant_id = p_restaurant and archived_at is null for update;
  if not found then return null; end if;
  insert into ingredient_purchases(restaurant_id, ingredient_id, request_ref, request_packs, quantity, total, recorded_by)
    values(p_restaurant, p_ingredient, p_ref, p_packs, p_packs * i.pack_size, p_total, p_actor)
    on conflict (restaurant_id, request_ref) where request_ref is not null do nothing returning id into v_id;
  if v_id is null then raise exception 'purchase reference changed' using errcode = 'PT409'; end if;
  v_price := round(p_total / p_packs, 2);
  if v_price is distinct from i.pack_price then update ingredients set pack_price = v_price, updated_by = p_actor where id = p_ingredient; end if;
  return v_id;
end;
$$;
revoke all on function public.record_purchase_once(uuid, uuid, numeric, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.record_purchase_once(uuid, uuid, numeric, numeric, text, uuid) to service_role;

-- Additive for rollout: old routes still log after calling the old RPC.
-- New routes use this writer so a lost reply cannot lose or duplicate its log.
create or replace function public.record_purchase_once_v2(
  p_restaurant uuid, p_ingredient uuid, p_packs numeric, p_total numeric, p_actor text, p_ref uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_previous uuid; v_id uuid; v_name text;
begin
  perform public.lock_ingredient_movements(p_restaurant);
  select id into v_previous from ingredient_purchases where restaurant_id = p_restaurant and request_ref = p_ref;
  -- The old writer verifies the complete saved request, including on replay.
  v_id := public.record_purchase_once(p_restaurant, p_ingredient, p_packs, p_total, p_actor, p_ref);
  if v_id is not null and v_previous is null then
    select i.name into v_name from ingredients i where i.restaurant_id = p_restaurant and i.id = p_ingredient;
    -- The saved purchase and its one paid log commit together. A replay exits
    -- without a second paid entry, even when the HTTP reply was lost.
    insert into user_logs(restaurant_id, actor_email, entity, action, detail)
      values(p_restaurant, p_actor, 'costs', 'paid',
        'note=' || replace(v_name || ' × ' || p_packs::text, ' ', '_') || ' amount=' || to_char(p_total, 'FM999999999990.00'));
  end if;
  return v_id;
end;
$$;
revoke all on function public.record_purchase_once_v2(uuid, uuid, numeric, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.record_purchase_once_v2(uuid, uuid, numeric, numeric, text, uuid) to service_role;

create or replace function public.record_waste_once(
  p_restaurant uuid, p_ingredient uuid, p_item uuid, p_quantity numeric,
  p_reason text, p_note text, p_cost numeric, p_actor text, p_ref uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare w waste_entries; v_id uuid; v_name text; v_stock int;
begin
  -- Product waste takes its item lock before the movement lock, like sales.
  if p_item is not null then perform 1 from menu_items where id = p_item and restaurant_id = p_restaurant for update; end if;
  perform public.lock_ingredient_movements(p_restaurant);
  select * into w from waste_entries where restaurant_id = p_restaurant and request_ref = p_ref;
  -- Cost is calculated by the server and may change after a delivery.
  if found and (w.ingredient_id, w.item_id, w.quantity, w.reason, w.note) is distinct from
     (p_ingredient, p_item, p_quantity, p_reason, p_note) then
    raise exception 'reference belongs to another waste entry' using errcode = 'PT409';
  end if;
  if found then return w.id; end if;
  if p_ref is null or (p_ingredient is null) = (p_item is null) then return null; end if;
  if p_ingredient is not null then
    select name into v_name from ingredients where id = p_ingredient and restaurant_id = p_restaurant and archived_at is null for update;
  else
    select name, stock into v_name, v_stock from menu_items where id = p_item and restaurant_id = p_restaurant;
  end if;
  if v_name is null then return null; end if;
  perform set_config('tabletap.stock_movement', 'on', true);
  insert into waste_entries(restaurant_id, ingredient_id, item_id, request_ref, name, quantity, reason, note, cost, recorded_by)
    values(p_restaurant, p_ingredient, p_item, p_ref, v_name, p_quantity, p_reason, p_note, p_cost, p_actor)
    on conflict (restaurant_id, request_ref) where request_ref is not null do nothing returning id into v_id;
  if v_id is null then raise exception 'waste reference changed' using errcode = 'PT409'; end if;
  if v_stock is not null then
    update menu_items set stock = greatest(v_stock - ceil(p_quantity)::int, 0),
      available = case when v_stock - ceil(p_quantity)::int <= 0 then false else available end,
      stock_auto_off = case when v_stock - ceil(p_quantity)::int <= 0 and available then true else stock_auto_off end where id = p_item;
  end if;
  return v_id;
end;
$$;
revoke all on function public.record_waste_once(uuid, uuid, uuid, numeric, text, text, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.record_waste_once(uuid, uuid, uuid, numeric, text, text, numeric, text, uuid) to service_role;

create or replace function public.record_ingredient_counts_once(p_restaurant uuid, p_counts jsonb, p_actor text, p_ref uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_results jsonb;
begin
  perform public.lock_ingredient_movements(p_restaurant);
  select jsonb_agg(jsonb_build_object('ingredient_id', ingredient_id, 'counted', counted, 'expected', expected,
    'movement_cutoff', movement_cutoff) order by ingredient_id) into v_results from ingredient_counts
    where restaurant_id = p_restaurant and request_ref = p_ref;
  if v_results is not null then
    if (select jsonb_agg(jsonb_build_object('ingredient_id', c.ingredient_id, 'counted', c.counted) order by c.ingredient_id)
        from jsonb_to_recordset(p_counts) as c(ingredient_id uuid, counted numeric)) is distinct from
       (select jsonb_agg(jsonb_build_object('ingredient_id', c.ingredient_id, 'counted', c.counted) order by c.ingredient_id)
        from ingredient_counts c where c.restaurant_id = p_restaurant and c.request_ref = p_ref) then
      raise exception 'reference belongs to another count' using errcode = 'PT409';
    end if;
  end if;
  if v_results is not null then return v_results; end if;
  if p_ref is null or jsonb_typeof(p_counts) is distinct from 'array' then raise exception 'invalid counts'; end if;
  if jsonb_array_length(p_counts) not between 1 and 500 or exists (
    select 1 from jsonb_to_recordset(p_counts) as c(ingredient_id uuid, counted numeric)
      where ingredient_id is null or counted is null or counted < 0 or counted > 10000000
        or counted::text in ('NaN', 'Infinity', '-Infinity') or counted <> round(counted, 3)
  ) or (select count(distinct c->>'ingredient_id') from jsonb_array_elements(p_counts) c) <> jsonb_array_length(p_counts) then raise exception 'invalid counts'; end if;
  if exists(select 1 from jsonb_to_recordset(p_counts) as c(ingredient_id uuid) where not exists(
    select 1 from ingredients i where i.id = c.ingredient_id and i.restaurant_id = p_restaurant and i.archived_at is null
  )) then return null; end if;
  insert into ingredient_counts(restaurant_id, ingredient_id, request_ref, counted, counted_by)
    select p_restaurant, c.ingredient_id, p_ref, c.counted, p_actor from jsonb_to_recordset(p_counts) as c(ingredient_id uuid, counted numeric)
    on conflict (restaurant_id, request_ref, ingredient_id) where request_ref is not null do nothing;
  select jsonb_agg(jsonb_build_object('ingredient_id', ingredient_id, 'counted', counted, 'expected', expected,
    'movement_cutoff', movement_cutoff) order by ingredient_id) into v_results from ingredient_counts
    where restaurant_id = p_restaurant and request_ref = p_ref;
  return v_results;
end;
$$;
revoke all on function public.record_ingredient_counts_once(uuid, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function public.record_ingredient_counts_once(uuid, jsonb, text, uuid) to service_role;

create or replace function public.close_cash_shift_once(p_restaurant uuid, p_shift uuid, p_counted numeric, p_actor text, p_ref uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s cash_shifts; v_result jsonb;
begin
  perform public.lock_restaurant_money(p_restaurant);
  if p_ref is null then return null; end if;
  select * into s from cash_shifts where restaurant_id = p_restaurant and close_ref = p_ref;
  if found then
    if s.id is distinct from p_shift or (s.close_result->>'counted')::numeric is distinct from p_counted then
      raise exception 'reference belongs to another close' using errcode = 'PT409';
    end if;
    if s.id = p_shift then return s.close_result; end if;
    return null;
  end if;
  -- The old closer still computes and signs the count under this same lock.
  v_result := public.close_cash_shift(p_restaurant, p_shift, p_counted, p_actor);
  if v_result is null then return null; end if;
  update cash_shifts set close_ref = p_ref, close_result = v_result where restaurant_id = p_restaurant and id = p_shift;
  return v_result;
end;
$$;
revoke all on function public.close_cash_shift_once(uuid, uuid, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.close_cash_shift_once(uuid, uuid, numeric, text, uuid) to service_role;
-- S21: refuse a changed handful before writing any of it. The old batch stays
-- available for deployed callers and recovery of its historical partial writes.
create or replace function public.collect_table_reviewed_v1(
  p_restaurant uuid, p_table uuid, p_expected numeric, p_currency text,
  p_amount numeric, p_tip numeric, p_method text, p_actor text, p_ref text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owed numeric; v_seen numeric; v_tip numeric; v_left numeric; v_take numeric;
  v_session uuid; v_ids uuid[]; v_row record; v_first boolean := true;
  v_scope text := coalesce(current_setting('tabletap.allocation_scope', true), '');
begin
  if p_restaurant is null or p_table is null or p_currency is null or p_currency not in ('MXN', 'USD')
    or p_expected is null or p_expected <= 0 or p_amount is null or p_amount <= 0 or p_amount > p_expected
    or p_tip is null or p_tip < 0 or p_tip > p_amount or p_method is null or p_method not in ('cash', 'card')
    or nullif(btrim(p_ref), '') is null or p_expected::text in ('NaN','Infinity','-Infinity')
    or p_amount::text in ('NaN','Infinity','-Infinity') or p_tip::text in ('NaN','Infinity','-Infinity')
    or p_expected <> round(p_expected,2) or p_amount <> round(p_amount,2) or p_tip <> round(p_tip,2) then
    raise exception 'invalid reviewed collection';
  end if;
  perform public.lock_restaurant_money(p_restaurant);
  perform set_config('tabletap.allocation_writer', 'v1', true);
  perform public.backfill_payment_allocations(p_restaurant);
  -- A lost response returns the saved receipt even after the bill has closed.
  select coalesce(sum(amount),0), coalesce(sum(tip),0) into v_seen,v_tip from payments
    where restaurant_id = p_restaurant and (client_ref = p_ref or left(client_ref,length(p_ref)+1) = p_ref || '#');
  if v_seen > 0 then
    if v_seen <> p_amount + p_tip or exists(select 1 from payments p where p.restaurant_id = p_restaurant
      and (p.client_ref = p_ref or left(p.client_ref,length(p_ref)+1) = p_ref || '#')
      and (p.currency is distinct from p_currency or not exists(select 1 from table_sessions s where s.id = p.session_id and s.table_id = p_table and s.restaurant_id = p_restaurant))) then
      raise exception 'collection reference differs';
    end if;
    return jsonb_build_object('outcome','duplicate','amount',v_seen,'tip',v_tip,'currency',p_currency);
  end if;
  perform 1 from orders where restaurant_id = p_restaurant and table_id = p_table
    and currency = p_currency and not paid and not written_off and account_id is null
    and status not in ('cancelled','pending_payment') order by id for update;
  select coalesce(sum(total - public.retained_order_coverage(p_restaurant,id)),0), array_agg(id order by created_at,id)
    into v_owed,v_ids from orders where restaurant_id = p_restaurant and table_id = p_table
    and currency = p_currency and not paid and not written_off and account_id is null
    and status not in ('cancelled','pending_payment');
  if v_owed <> p_expected then
    return jsonb_build_object('outcome','changed','owed',v_owed,'currency',p_currency);
  end if;
  if exists(select 1 from orders where id = any(v_ids) and card_checkout_at > now() - interval '35 minutes') then
    return jsonb_build_object('outcome','paying');
  end if;
  if exists(select 1 from orders where id = any(v_ids) and session_id is null) then
    v_session := public.open_table_session(p_restaurant,p_table,8,p_actor);
    update orders set session_id = v_session where id = any(v_ids) and session_id is null;
  end if;
  -- Only this currency's orders enter a receipt, even on a mixed sitting.
  perform set_config('tabletap.allocation_scope',to_json(v_ids)::text,true);
  v_left := p_amount;
  for v_row in select session_id, min(created_at) as first_at,
    sum(total - public.retained_order_coverage(p_restaurant,id)) as owed,
    sum(greatest(tip - coalesce((select sum(a.tip) from payment_allocations a where a.order_id = orders.id),0),0)) as old_tip
    from orders where id = any(v_ids) group by session_id order by first_at, session_id loop
    exit when v_left <= 0;
    if exists(select 1 from payments where restaurant_id = p_restaurant and session_id = v_row.session_id
      and allocation_quality = 'unresolved') then raise exception 'historical pooled money requires attribution'; end if;
    v_take := least(v_left,v_row.owed);
    if v_take <= 0 then continue; end if;
    v_tip := case when v_first then p_tip else 0 end;
    if v_tip > 0 then
      update orders set total = total + v_tip, tip = tip + v_tip where id = (
        select id from orders where id = any(v_ids) and session_id = v_row.session_id order by created_at,id limit 1);
    end if;
    insert into payments(restaurant_id,session_id,amount,tip,method,actor_email,client_ref)
      values(p_restaurant,v_row.session_id,v_take + v_tip,
        v_tip + round(v_take * least(v_row.owed,v_row.old_tip) / v_row.owed,2),p_method,p_actor,
        p_ref || '#' || v_row.session_id::text);
    update bill_splits set status = 'cancelled' where restaurant_id = p_restaurant
      and session_id = v_row.session_id and status in ('proposed','locked');
    v_first := false;
    v_left := v_left - v_take;
  end loop;
  if v_left <> 0 then raise exception 'reviewed collection changed'; end if;
  perform set_config('tabletap.allocation_scope',v_scope,true);
  select sum(amount),sum(tip) into v_seen,v_tip from payments where restaurant_id = p_restaurant
    and left(client_ref,length(p_ref)+1) = p_ref || '#';
  return jsonb_build_object('outcome','written','amount',v_seen,'tip',v_tip,'currency',p_currency);
end;
$$;
revoke all on function public.collect_table_reviewed_v1(uuid,uuid,numeric,text,numeric,numeric,text,text,text) from public,anon,authenticated;
grant execute on function public.collect_table_reviewed_v1(uuid,uuid,numeric,text,numeric,numeric,text,text,text) to service_role;


-- S21: collect one saved currency at a time; deployed account callers keep v2.
create or replace function public.account_settle_currency_v1(
  p_restaurant uuid,
  p_account    uuid,
  p_expected   numeric,
  p_tip        numeric,
  p_method     text,
  p_actor      text,
  p_ref        text,
  p_currency text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_account customer_accounts;
  v_ids     uuid[];
  v_owed    numeric;
  v_recorded_tip numeric;
  v_tip     numeric := greatest(coalesce(p_tip, 0), 0);
begin
  if p_currency is null or p_currency not in ('MXN', 'USD') then raise exception 'invalid account currency'; end if;
  perform public.lock_restaurant_money(p_restaurant);
  perform set_config('tabletap.allocation_writer', 'v1', true);
  if p_restaurant is not null then perform public.backfill_payment_allocations(p_restaurant); end if;
  perform set_config('tabletap.allocation_scope', '', true);
  select * into v_account from customer_accounts
   where id = p_account and restaurant_id = p_restaurant for update;
  if v_account.id is null then return jsonb_build_object('outcome', 'missing'); end if;
  if p_ref is not null and exists (select 1 from payments
                                    where restaurant_id = p_restaurant and client_ref = p_ref) then
    if exists(select 1 from payments where restaurant_id = p_restaurant and client_ref = p_ref
      and (account_id is distinct from p_account or currency is distinct from p_currency or amount <> p_expected + p_tip)) then
      raise exception 'account collection reference differs';
    end if;
    return (select jsonb_build_object('outcome','duplicate','amount',amount,'tip',tip,'currency',currency) from payments where restaurant_id = p_restaurant and client_ref = p_ref);
  end if;
  if v_account.checkout_until is not null and v_account.checkout_until > now() then
    return jsonb_build_object('outcome', 'paying');
  end if;

  perform 1 from orders where restaurant_id = p_restaurant and currency = p_currency and account_id = p_account and paid = false and written_off = false and status <> 'cancelled' order by id for update;
  select coalesce(sum(total), 0), array_agg(id order by created_at desc)
    into v_owed, v_ids
    from orders where restaurant_id = p_restaurant and currency = p_currency and account_id = p_account and paid = false and written_off = false and status <> 'cancelled';
  if v_owed <= 0 then return jsonb_build_object('outcome', 'nothing'); end if;
  if abs(v_owed - p_expected) > 0.005 then
    return jsonb_build_object('outcome', 'changed', 'owed', v_owed);
  end if;
  -- A gratuity is never more than what it thanks somebody for.
  v_tip := least(v_tip, v_owed);

  perform set_config('tabletap.allocation_scope',to_json(v_ids)::text,true);
  insert into payments (restaurant_id, account_id, amount, tip, method, actor_email, client_ref)
  values (p_restaurant, p_account, v_owed + v_tip,
    v_tip + (select coalesce(sum(tip), 0) from orders where id = any(v_ids) and written_off = false), p_method, p_actor, p_ref) returning tip into v_recorded_tip;
  update orders set paid = true, pay_method = p_method where id = any(v_ids);
  -- The gratuity lands on the latest order, as a table's does on its first.
  if v_tip > 0 then
    update orders set tip = tip + v_tip, total = total + v_tip where id = v_ids[1];
  end if;
  perform set_config('tabletap.allocation_scope','',true);
  return jsonb_build_object('outcome', 'paid', 'amount', v_owed + v_tip, 'tip', v_recorded_tip, 'currency', p_currency);
end;
$$;
revoke all on function public.account_settle_currency_v1(uuid, uuid, numeric, numeric, text, text, text, text) from public, anon, authenticated;
grant execute on function public.account_settle_currency_v1(uuid, uuid, numeric, numeric, text, text, text, text) to service_role;


-- S21: collect one saved currency at a time; deployed account callers keep v2.
create or replace function public.account_checkout_currency_v1(
  p_restaurant uuid,
  p_account    uuid,
  p_expected   numeric,
  p_tip        numeric,
  p_fee        numeric,
  p_currency text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_account customer_accounts;
  v_ids     uuid[];
  v_owed    numeric;
  v_tip     numeric := greatest(coalesce(p_tip, 0), 0);
  v_id      uuid;
begin
  if p_currency is null or p_currency not in ('MXN', 'USD') then raise exception 'invalid account currency'; end if;
  perform public.lock_restaurant_money(p_restaurant);
  perform set_config('tabletap.allocation_writer', 'v1', true);
  if p_restaurant is not null then perform public.backfill_payment_allocations(p_restaurant); end if;
  select * into v_account from customer_accounts
   where id = p_account and restaurant_id = p_restaurant for update;
  if v_account.id is null then return jsonb_build_object('outcome', 'missing'); end if;
  if v_account.checkout_until is not null and v_account.checkout_until > now() then
    return jsonb_build_object('outcome', 'paying');
  end if;
  perform 1 from orders where restaurant_id = p_restaurant and currency = p_currency and account_id = p_account and paid = false
    and written_off = false and status <> 'cancelled' order by id for update;
  select coalesce(sum(total), 0), array_agg(id order by created_at desc)
    into v_owed, v_ids
    from orders where restaurant_id = p_restaurant and currency = p_currency and account_id = p_account and paid = false and written_off = false and status <> 'cancelled';
  if v_owed <= 0 then return jsonb_build_object('outcome', 'nothing'); end if;
  if abs(v_owed - p_expected) > 0.005 then
    return jsonb_build_object('outcome', 'changed', 'owed', v_owed);
  end if;
  -- A checkout still open once its hold has lapsed is dead: its Stripe session
  -- expired at thirty minutes, five before the hold. Closed here, so its
  -- expiry arriving late (Stripe retries for days) finds nothing to release.
  -- Releasing it lifted the hold of the checkout opened now, and the till
  -- could collect the account while the customer was paying it by card.
  update account_checkouts set status = 'expired' where account_id = p_account and status = 'open';
  v_tip := least(v_tip, v_owed);
  insert into account_checkouts (restaurant_id, account_id, order_ids, amount, tip, fee)
  values (p_restaurant, p_account, v_ids, v_owed, v_tip, greatest(coalesce(p_fee, 0), 0)) returning id into v_id;
  update customer_accounts set checkout_until = now() + interval '35 minutes', checkout_id = v_id where id = p_account;
  return jsonb_build_object('outcome', 'open', 'checkout', v_id, 'amount', v_owed, 'tip', v_tip);
end;
$$;
revoke all on function public.account_checkout_currency_v1(uuid, uuid, numeric, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.account_checkout_currency_v1(uuid, uuid, numeric, numeric, numeric, text) to service_role;

-- S23 K11: the dish and its extras save together. A refused link insert must
-- roll back the replacement, rather than leave the dish with no choices.
create or replace function public.save_product_addons_v1(
  p_restaurant uuid, p_product uuid, p_addons uuid[], p_changes jsonb,
  p_menu uuid default null, p_category uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_product menu_items%rowtype;
  v_next menu_items%rowtype;
begin
  -- Keep a concurrent plan freeze on the same side of this write. The secret
  -- key skips browser-only triggers, so this transaction checks it itself.
  perform 1 from restaurants where id = p_restaurant
    and plan_status is distinct from 'locked' for no key update;
  if not found then raise exception 'tt_plan_frozen'; end if;
  if p_addons is null or p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'Invalid product edit';
  end if;
  -- The route only sends editable fields; keep the same boundary here too.
  if exists (select 1 from jsonb_object_keys(p_changes) as k(key)
    where key not in ('name','description','price','image_url','emoji','popular',
      'modifiers','dietary','discount_pct','skips_kitchen','category_id')
      and not (p_product is null and key = 'stock')) then
    raise exception 'Invalid product field';
  end if;
  if p_product is null then
    perform 1 from menus where id = p_menu and restaurant_id = p_restaurant for key share;
    if not found then return null; end if;
    if p_category is not null and not exists (select 1 from categories
      where id = p_category and restaurant_id = p_restaurant and menu_id = p_menu) then
      raise exception 'Invalid product section';
    end if;
    v_next := jsonb_populate_record(null::menu_items, p_changes);
    if v_next.stock is not null and not exists (select 1 from plan_limits
      where plan = public.effective_restaurant_plan(p_restaurant) and allows_inventory) then
      raise exception 'tt_plan_feature allows_inventory';
    end if;
    insert into menu_items(restaurant_id, menu_id, category_id, is_addon, name,
      description, price, image_url, emoji, popular, modifiers, dietary,
      discount_pct, skips_kitchen, stock, sort_order)
    values(p_restaurant, p_menu, p_category, false, v_next.name,
      coalesce(v_next.description, ''), v_next.price, v_next.image_url,
      coalesce(v_next.emoji, ''), coalesce(v_next.popular, false),
      coalesce(v_next.modifiers, '[]'::jsonb), coalesce(v_next.dietary, '{}'::text[]),
      coalesce(v_next.discount_pct, 0), coalesce(v_next.skips_kitchen, false), v_next.stock,
      (select coalesce(max(sort_order), -1) + 1 from menu_items where menu_id = p_menu))
    returning * into v_product;
  else
    select * into v_product from menu_items
      where id = p_product and restaurant_id = p_restaurant and not is_addon for update;
    if not found then return null; end if;
  end if;
  perform 1 from menu_items where id = any(p_addons) order by id for key share;
  if (select count(*) from menu_items where id = any(p_addons)
      and restaurant_id = p_restaurant and menu_id is not distinct from v_product.menu_id and is_addon)
      <> cardinality(p_addons) then
    raise exception 'Invalid product extras';
  end if;
  if p_product is not null and p_changes <> '{}'::jsonb then
    v_next := jsonb_populate_record(v_product, p_changes);
    if v_next.category_id is not null and not exists (select 1 from categories
      where id = v_next.category_id and restaurant_id = p_restaurant and menu_id = v_product.menu_id) then
      raise exception 'Invalid product section';
    end if;
    update menu_items set name = v_next.name, description = v_next.description,
      price = v_next.price, image_url = v_next.image_url, emoji = v_next.emoji,
      popular = v_next.popular, modifiers = v_next.modifiers, dietary = v_next.dietary,
      discount_pct = v_next.discount_pct, skips_kitchen = v_next.skips_kitchen,
      category_id = v_next.category_id where id = p_product;
  end if;
  delete from item_addons where product_id = v_product.id;
  insert into item_addons(product_id, addon_id, sort_order)
    select v_product.id, a.id, (a.position - 1)::integer
      from unnest(p_addons) with ordinality as a(id, position);
  return v_product.id;
end;
$$;
revoke all on function public.save_product_addons_v1(uuid, uuid, uuid[], jsonb, uuid, uuid) from public, anon, authenticated;
grant execute on function public.save_product_addons_v1(uuid, uuid, uuid[], jsonb, uuid, uuid) to service_role;
