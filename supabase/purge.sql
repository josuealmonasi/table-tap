-- ============================================================================
-- TableTap — PURGE all rows (DESTRUCTIVE, but keeps the tables/structure)
-- Empties every table; the schema, policies, and indexes stay in place.
-- Run via: pnpm db:purge   (or paste into the Supabase SQL Editor)
-- After this, run `pnpm db:seed` to re-insert the demo data.
--
-- The list is the ROOTS, not every table: `cascade` follows the foreign keys
-- outward, and everything a restaurant owns hangs off one of these. Listing all
-- thirty would be a list that goes stale — this one only changes when a table
-- arrives that nothing points at. Two are deliberately outside it:
--
--   plan_limits   the price list, not anybody's data. `schema.sql` writes it.
--   rate_limits   nothing references it, so nothing cascades to it — which is
--                 why it is named below rather than left to be reached.
-- ============================================================================
truncate table
  rate_limits,
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
