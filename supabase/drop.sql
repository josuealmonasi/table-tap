-- ============================================================================
-- TableTap — DROP everything (DESTRUCTIVE)
-- Removes the tables, their data, policies, and indexes entirely.
-- Run via: pnpm db:drop   (or paste into the Supabase SQL Editor)
-- After this, run `pnpm db:seed` to recreate the schema.
--
-- Keep this list in sync with schema.sql — a table missing here survives a
-- reset with stale rows, and its policies keep the helper functions alive, so
-- the function drops below fail and the whole reset stops half done. That is
-- exactly what happened: eight tables added after this file was written were
-- never added to it.
--
-- Generated from the `create table if not exists` lines in schema.sql; when
-- you add a table there, add it here.
-- ============================================================================
drop table if exists table_sessions      cascade;
drop table if exists write_off_requests  cascade;
drop table if exists discount_requests   cascade;
drop table if exists coupon_redemptions  cascade;
drop table if exists coupons             cascade;
drop table if exists promotion_items     cascade;
drop table if exists promotions          cascade;
drop table if exists dish_ratings        cascade;
drop table if exists rate_limits         cascade;
drop table if exists user_logs           cascade;
drop table if exists platform_admins     cascade;
drop table if exists profiles            cascade;
drop table if exists staff               cascade;
drop table if exists service_requests    cascade;
drop table if exists orders              cascade;
drop table if exists item_addons         cascade;
drop table if exists menu_items          cascade;
drop table if exists categories          cascade;
drop table if exists menus               cascade;
drop table if exists restaurant_tables   cascade;
drop table if exists restaurants         cascade;
drop table if exists plan_limits         cascade;

-- Storage policies live on storage.objects, which is not one of our tables, so
-- dropping ours does not release the helpers these mention. schema.sql
-- recreates both, guarded against already existing.
drop policy if exists "menu images are public to read" on storage.objects;
drop policy if exists "team manages its own menu images" on storage.objects;

-- Policy and service functions (schema.sql recreates them). Dropped after the
-- tables and the storage policies, because anything that mentions one of these
-- holds it open.
drop function if exists public.claim_founding_price(uuid, int);
drop function if exists public.close_session_if_clear(uuid, text);
drop function if exists public.open_table_session(uuid, uuid, int);
drop function if exists public.redeem_coupon(uuid);
drop function if exists public.release_coupon(uuid);
drop function if exists public.rate_limit_hit(text, int);
drop function if exists public.dish_rating_stats(uuid);
drop function if exists public.plan_ceiling(uuid, text);
drop function if exists public.enforce_plan_limit();
drop function if exists public.storage_restaurant(text);
drop function if exists public.has_role(uuid, text[]);
drop function if exists public.works_at(uuid);
drop function if exists public.owns_restaurant(uuid);
