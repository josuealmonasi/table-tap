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
drop table if exists platform_fees       cascade;
drop table if exists terminal_deposits   cascade;
drop table if exists waste_entries       cascade;
drop table if exists ingredient_purchases cascade;
drop table if exists ingredient_counts   cascade;
drop table if exists recipe_lines        cascade;
drop table if exists ingredient_prices   cascade;
drop table if exists ingredients         cascade;
drop table if exists cash_movements      cascade;
drop table if exists cash_shifts         cascade;
drop table if exists stock_reservations cascade;
drop table if exists account_checkouts   cascade;
drop table if exists customer_accounts   cascade;
drop table if exists loyalty_redemptions cascade;
drop table if exists loyalty_visits      cascade;
drop table if exists loyalty_cards       cascade;
drop table if exists loyalty_programs    cascade;
drop table if exists print_jobs          cascade;
drop table if exists bill_split_claims   cascade;
drop table if exists bill_splits         cascade;
drop table if exists payments             cascade;
drop table if exists refunds_due          cascade;
drop table if exists notifications       cascade;
drop table if exists dietary_tags        cascade;
drop table if exists icon_group_items    cascade;
drop table if exists icon_groups         cascade;
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
-- The till transactions depend on the stock and account helpers below.
drop function if exists public.ring_pos_account(uuid, uuid, jsonb, uuid, text, text, jsonb, boolean, int);
drop function if exists public.ring_pos_sale(uuid, uuid, jsonb, text, text, text, timestamptz, text, jsonb, boolean, int);
drop function if exists public.pos_insert_order(uuid, uuid, jsonb, text, timestamptz, uuid);
drop function if exists public.pos_ticket(uuid, uuid);

drop function if exists public.account_owed(uuid);
drop function if exists public.account_change(uuid, uuid, text, numeric, text);
drop function if exists public.account_charge(uuid, uuid, uuid[], numeric, text);
drop function if exists public.account_settle(uuid, uuid, numeric, numeric, text, text, text);
drop function if exists public.account_checkout_open(uuid, uuid, numeric, numeric, numeric);
drop function if exists public.account_checkout_settle(uuid, text);
drop function if exists public.account_checkout_release(uuid);
drop function if exists public.loyalty_redeem(uuid, text, text);
drop function if exists public.loyalty_redeem(uuid, text, text, int);
drop function if exists public.loyalty_stamp(uuid, text, text);
drop function if exists public.loyalty_unstamp(uuid, uuid, date);
drop function if exists public.loyalty_progress(uuid);
drop function if exists public.loyalty_steps_ok(jsonb);
drop function if exists public.claim_founding_price(uuid, int);
drop function if exists public.close_session_if_clear(uuid, text);
drop function if exists public.collect_on_sitting(uuid, uuid, numeric, numeric, text, text, text) cascade;
drop function if exists public.settle_orders(uuid, uuid[], text, text, jsonb);
drop function if exists public.settle_card_orders(uuid[], text, numeric, uuid, text, numeric);
drop function if exists public.settle_split_share(uuid, int, numeric, numeric, text);
drop function if exists public.settle_sale(uuid, uuid, text, text, text);
drop function if exists public.open_table_session(uuid, uuid, int);
drop function if exists public.join_bill_split(uuid, text, numeric);
drop function if exists public.join_bill_split(uuid, text, uuid, uuid, uuid);
drop function if exists public.close_divided_bill(uuid);
drop function if exists public.reserve_stock(uuid, jsonb, int);
drop function if exists public.release_stock(uuid, jsonb);
drop function if exists public.enqueue_kitchen_ticket();
drop function if exists public.mark_station_ready(uuid, uuid, text);
drop function if exists public.complete_when_paid();
drop function if exists public.redeem_coupon(uuid);
drop function if exists public.release_coupon(uuid);
drop function if exists public.rate_limit_hit(text, int);
drop function if exists public.dish_rating_stats(uuid);
drop function if exists public.plan_ceiling(uuid, text);
drop function if exists public.enforce_plan_feature();
drop function if exists public.enforce_plan_limit();
drop function if exists public.seed_dietary_tags_on_new_restaurant();
drop function if exists public.seed_dietary_tags(uuid);
drop function if exists public.storage_restaurant(text);
drop function if exists public.has_role(uuid, text[]);
drop function if exists public.works_at(uuid);
drop function if exists public.owns_restaurant(uuid);

drop function if exists public.reserve_stock(uuid, jsonb, int, uuid);
drop function if exists public.release_stock_reservation(uuid, uuid);
drop function if exists public.order_stock_reservation();
drop function if exists public.stock_tracking_epoch();
drop function if exists public.abandon_checkout(uuid, boolean);
drop function if exists public.recover_stock_reservations();

drop function if exists public.abandon_checkout(uuid, boolean, jsonb);
drop function if exists public.cancel_order(uuid, uuid, text, jsonb);
drop function if exists public.cancel_order(uuid, uuid, text, jsonb, boolean, uuid, timestamptz, uuid);
drop function if exists public.recover_stock_reservations(uuid);
drop function if exists public.record_ingredient_price();
drop function if exists public.recipe_line_same_restaurant();
drop function if exists public.replace_recipe(uuid, uuid, jsonb);
drop function if exists public.archive_ingredient(uuid, uuid, text);
drop function if exists public.record_waste(uuid, uuid, uuid, numeric, text, text, numeric, text);
drop function if exists public.record_purchase(uuid, uuid, numeric, numeric, text);
drop function if exists public.settle_offline_sale(uuid, uuid, text, text, timestamptz);
drop function if exists public.take_stock_floor(uuid, jsonb);
drop function if exists public.reserve_platform_fee(uuid, integer, integer, text, text);
drop function if exists public.take_platform_fee(uuid, text, integer);
drop function if exists public.release_platform_fee(uuid);
drop function if exists public.record_session_fee(uuid, text, integer, text, integer);
drop function if exists public.record_duplicate_share(uuid, text, numeric);
drop function if exists public.refund_platform_fee(uuid, text, integer, text);
