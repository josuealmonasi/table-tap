-- ============================================================================
-- TableTap — DROP everything (DESTRUCTIVE)
-- Removes the tables, their data, policies, and indexes entirely.
-- Run via: pnpm db:drop   (or paste into the Supabase SQL Editor)
-- After this, run `pnpm db:seed` to recreate the schema.
-- Keep this list in sync with schema.sql — a table missing here survives a
-- reset with stale rows and breaks the FK re-adds when the schema re-runs.
-- ============================================================================
drop table if exists user_logs          cascade;
drop table if exists platform_admins    cascade;
drop table if exists profiles           cascade;
drop table if exists staff              cascade;
drop table if exists service_requests   cascade;
drop table if exists orders             cascade;
drop table if exists item_addons        cascade;
drop table if exists menu_items         cascade;
drop table if exists categories         cascade;
drop table if exists menus              cascade;
drop table if exists restaurant_tables  cascade;
drop table if exists restaurants        cascade;

-- Policy helper functions (schema.sql recreates them).
drop function if exists public.has_role(uuid, text[]);
drop function if exists public.works_at(uuid);
drop function if exists public.owns_restaurant(uuid);
