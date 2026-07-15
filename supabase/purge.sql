-- ============================================================================
-- TableTap — PURGE all rows (DESTRUCTIVE, but keeps the tables/structure)
-- Empties every table; the schema, policies, and indexes stay in place.
-- Run via: pnpm db:purge   (or paste into the Supabase SQL Editor)
-- After this, run `pnpm db:seed` to re-insert the demo data.
-- Keep this list in sync with schema.sql.
-- ============================================================================
truncate table
  user_logs,
  platform_admins,
  profiles,
  staff,
  service_requests,
  orders,
  item_addons,
  menu_items,
  categories,
  menus,
  restaurant_tables,
  restaurants
restart identity cascade;
