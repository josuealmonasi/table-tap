-- ============================================================================
-- TableTap — DROP everything (DESTRUCTIVE)
-- Removes the tables, their data, policies, and indexes entirely.
-- Run via: pnpm database:drop   (or paste into the Supabase SQL Editor)
-- After this, run `pnpm seed` to recreate the schema.
-- ============================================================================
drop table if exists orders             cascade;
drop table if exists item_addons        cascade;
drop table if exists menu_items         cascade;
drop table if exists categories         cascade;
drop table if exists restaurant_tables  cascade;
drop table if exists restaurants        cascade;
