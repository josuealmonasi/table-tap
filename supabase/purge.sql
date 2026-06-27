-- ============================================================================
-- TableTap — PURGE all rows (DESTRUCTIVE, but keeps the tables/structure)
-- Empties every table; the schema, policies, and indexes stay in place.
-- Run via: pnpm database:purge   (or paste into the Supabase SQL Editor)
-- After this, run `pnpm seed` to re-insert the demo data.
-- ============================================================================
truncate table
  orders,
  menu_items,
  categories,
  restaurant_tables,
  restaurants
restart identity cascade;
