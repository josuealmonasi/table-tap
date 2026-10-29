drop table if exists restaurant_accounting_records cascade;
drop table if exists platform_admin_audit cascade;
drop function if exists public.check_item_addon_restaurant() cascade;
drop function if exists public.keep_platform_admin_audit();
drop function if exists public.admin_delete_restaurant(uuid, boolean);
drop function if exists public.advance_refund_due_fee(uuid, uuid, jsonb, int, int, int, text);
drop function if exists public.verify_refunded_platform_fee(uuid, text, int, int, text[]);
drop function if exists public.reverse_failed_refund(uuid, text, text, text);
drop function if exists public.reverse_failed_refund_v2(uuid, text, text, text, int, text);
drop function if exists public.verify_refunded_platform_fee_v2(uuid, text, int, int, text[], int);
drop function if exists public.refund_fee_epoch(uuid, text);
drop function if exists public.apply_verified_platform_fee(uuid, text, int, int, text[]);
drop function if exists public.save_refund_due_fee_target(uuid, uuid, int, int);
drop function if exists public.start_refund_due_fee_apply(uuid, uuid, text, int);
drop function if exists public.start_refund_due_fee_v2(uuid, uuid, text, int, int);
drop function if exists public.advance_refund_due_fee_apply(uuid, uuid, jsonb, int, int, int, text);
drop function if exists public.advance_refund_due_fee_v2(uuid, uuid, jsonb, int, int, int, text, int);
drop function if exists public.bump_fee_revision(uuid, text);
drop function if exists public.prepare_fee_return(uuid, text, text, text, text, int, int, int);
drop function if exists public.claim_fee_return(uuid, uuid, int, int);
drop function if exists public.record_fee_return(uuid, uuid, text);
drop function if exists public.enqueue_fee_reconcile(uuid, text);
drop function if exists public.ack_fee_reconcile(uuid, text, int);
drop function if exists public.finish_refund_due_attempt_v2(uuid, uuid, uuid, text, jsonb, text);
drop function if exists public.record_refund_due_coverage_v1(uuid, uuid, text, jsonb);
drop function if exists public.start_refund_due_attempt_v2(uuid, uuid, int);
drop function if exists public.guard_fee_return() cascade;
drop function if exists public.refund_fee_proven_clear(uuid, text);
drop table if exists table_session_members cascade;
drop function if exists public.recount_stock(uuid, uuid, int, int, int) cascade;
drop function if exists public.request_table_member(uuid, uuid, text, boolean);
drop function if exists public.decide_table_member(uuid, uuid, uuid, boolean, text, text);
drop table if exists refund_due_attempts cascade;
drop table if exists refund_failures cascade;
drop table if exists refund_fee_epochs cascade;
drop table if exists fee_returns cascade;
drop table if exists fee_reconcile_queue cascade;
drop table if exists refund_due_coverage cascade;
drop table if exists refund_attempts cascade;
drop table if exists refund_allocations cascade;
drop table if exists refund_operations cascade;
drop table if exists order_adjustments cascade;
drop table if exists payment_allocations cascade;
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
drop table if exists restaurant_billing_operations cascade;
drop function if exists public.claim_restaurant_billing(uuid, uuid);
drop function if exists public.record_restaurant_billing(uuid, uuid, jsonb);
drop function if exists public.takeover_restaurant_billing(uuid, uuid, uuid, timestamptz, jsonb);
drop function if exists public.release_restaurant_billing(uuid, uuid);
drop table if exists diner_checkouts cascade;
drop table if exists platform_fees       cascade;
drop table if exists terminal_deposits   cascade;
drop table if exists ingredient_consumption cascade;
drop table if exists ingredient_movements cascade;

drop function if exists public.delete_terminal_deposit_v1(uuid, date, text);
drop function if exists public.record_terminal_deposit_v1(uuid, date, text, numeric, text, text);
drop function if exists public.terminal_deposit_ledger_v1(uuid, text);
drop table if exists waste_entries       cascade;
drop table if exists ingredient_purchases cascade;
drop table if exists ingredient_counts   cascade;
drop table if exists recipe_lines        cascade;
drop table if exists ingredient_prices   cascade;
drop table if exists ingredients         cascade;
drop table if exists cash_movements      cascade;
drop table if exists cash_shifts         cascade;
drop function if exists public.freeze_cash_currency();
drop function if exists public.cash_shift_totals(uuid, uuid, timestamptz);
drop function if exists public.close_cash_shift(uuid, uuid, numeric, text);
drop function if exists public.create_cash_withdrawal(uuid, uuid, numeric, text, text);
drop function if exists public.delete_cash_withdrawal(uuid, uuid, uuid);
drop function if exists public.cash_shifts_for_day(uuid, timestamptz);
drop table if exists stock_reservations cascade;
drop table if exists account_checkouts   cascade;
drop table if exists customer_accounts   cascade;
drop table if exists loyalty_redemptions cascade;
drop table if exists loyalty_visits      cascade;
drop table if exists loyalty_cards       cascade;
drop table if exists loyalty_programs    cascade;
drop table if exists print_jobs          cascade;
drop table if exists bill_split_checkout_slots cascade;
drop table if exists bill_split_slots    cascade;
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
drop table if exists kitchen_requests    cascade;
drop table if exists kitchen_tickets     cascade;
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
drop function if exists public.loyalty_redeem_once(uuid, text, text, int, int, uuid);
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
drop function if exists public.approve_write_off_request(uuid, uuid, text, numeric, text);
drop function if exists public.approve_discount_request(uuid, uuid, text, numeric);
drop function if exists public.keep_order_terminal();

drop table if exists restaurant_subscription_prices cascade;
drop function if exists public.effective_restaurant_plan(uuid);
drop function if exists public.enforce_dashboard_write();
drop function if exists public.enforce_dashboard_write_child();

drop function if exists public.lock_restaurant_money(uuid) cascade;
drop function if exists public.snapshot_payment_scope() cascade;
drop function if exists public.allocate_receipt(uuid) cascade;
drop function if exists public.finish_payment_allocation() cascade;
drop function if exists public.check_receipt_allocations() cascade;
drop function if exists public.backfill_payment_allocations(uuid) cascade;
drop function if exists public.tiers_sound(jsonb) cascade;
drop function if exists public.collect_on_sittings_v1(uuid, jsonb, text, text, text, numeric) cascade;
drop function if exists public.collect_on_sitting_v2(uuid, uuid, numeric, numeric, text, text, text) cascade;
drop function if exists public.order_refund_coverage(uuid, uuid) cascade;
drop function if exists public.prepare_order_refund(uuid, uuid, text, jsonb, boolean, uuid, timestamptz, uuid) cascade;
drop function if exists public.start_refund_attempt(uuid, uuid) cascade;
drop function if exists public.finish_refund_operation(uuid, uuid, text, text, text) cascade;
drop function if exists public.retained_order_coverage(uuid, uuid) cascade;
drop function if exists public.guard_allocated_order() cascade;
drop function if exists public.check_refund_allocations() cascade;
drop function if exists public.immutable_allocation() cascade;
drop function if exists public.order_coverage(uuid, uuid[]) cascade;
drop function if exists public.check_paid_coverage() cascade;
drop function if exists public.sync_refunded_platform_fee(uuid, text, int) cascade;
drop function if exists public.attribute_payment(uuid, uuid, text, jsonb) cascade;

drop function if exists public.finish_refund_operation(uuid, uuid, text, text, text, text, uuid) cascade;
drop function if exists public.attribute_payment(uuid, uuid, text, jsonb) cascade;
drop function if exists public.guard_receipt_money() cascade;
drop function if exists public.check_return_header() cascade;
drop function if exists public.guard_return_money() cascade;

drop function if exists public.order_component_capacity(uuid, uuid);
drop function if exists public.import_historical_return(uuid, uuid);
drop function if exists public.join_bill_split_v2(uuid, text, uuid, uuid, uuid);
drop function if exists public.close_divided_bill_v2(uuid);
drop function if exists public.collect_on_sitting_v2(uuid, uuid, numeric, numeric, text, text, text);
drop function if exists public.settle_orders_v2(uuid, uuid[], text, text, jsonb);
drop function if exists public.settle_card_orders_v2(uuid[], text, numeric, uuid, text, numeric);
drop function if exists public.settle_split_share_v2(uuid, int, numeric, numeric, text);
drop function if exists public.settle_sale_v2(uuid, uuid, text, text, text);
drop function if exists public.account_charge_v2(uuid, uuid, uuid[], numeric, text);
drop function if exists public.account_change_v2(uuid, uuid, text, numeric, text);
drop function if exists public.account_settle_v2(uuid, uuid, numeric, numeric, text, text, text);
drop function if exists public.account_checkout_open_v2(uuid, uuid, numeric, numeric, numeric);
drop function if exists public.account_checkout_settle_v2(uuid, text);
drop function if exists public.settle_offline_sale_v2(uuid, uuid, text, text, timestamptz);
drop function if exists public.cancel_order_v2(uuid, uuid, text, jsonb, boolean, uuid, timestamptz, uuid);
drop function if exists public.ring_pos_sale_v2(uuid, uuid, jsonb, text, text, text, timestamptz, text, jsonb, boolean, int);
drop function if exists public.ring_pos_account_v2(uuid, uuid, jsonb, uuid, text, text, jsonb, boolean, int);
drop function if exists public.approve_write_off_request_v2(uuid, uuid, text, numeric, text);
drop function if exists public.write_off_orders(uuid, uuid[], text, text, text);
drop function if exists public.approve_discount_request_v2(uuid, uuid, text, numeric);
drop function if exists public.apply_bill_discount(uuid, uuid[], uuid, numeric);
drop function if exists public.reprice_open_service(uuid, numeric);
drop function if exists public.attribute_payment(uuid, uuid, text, jsonb, text, text, boolean);

drop function if exists public.start_refund_due_attempt(uuid, uuid);
drop function if exists public.finish_refund_due_attempt(uuid, uuid, uuid, text, text, text);

drop function if exists public.record_offline_sale(uuid,uuid,jsonb,text,text,timestamptz,text,jsonb,text,text,text,text) cascade;
drop function if exists public.guard_offline_audit() cascade;

drop function if exists public.queue_offline_sale(uuid,uuid,jsonb,text,text,text,text) cascade;
drop table if exists offline_sale_queue cascade;
drop function if exists public.return_on_order_v1(uuid, uuid, int, text, text, text, uuid, int, int, int);
drop function if exists public.retained_order_component_capacity_v1(uuid, uuid);
drop function if exists public.check_order_return_adjustment_v1();
drop function if exists public.refund_operation_progress_v1(uuid);
drop function if exists public.refund_id_taken_v1(uuid, text, uuid);
drop function if exists public.complete_refund_operation_v1(uuid, text);
drop function if exists public.record_order_return_coverage_v1(uuid, uuid, text, jsonb, uuid);
drop function if exists public.finish_refund_operation_v2(uuid, uuid, text, jsonb, text, text, uuid);
drop function if exists public.guard_refund_attempt_request_v1();
drop function if exists public.order_return_events_v1(uuid, text);
drop function if exists public.refund_owned_by_return_v1(uuid, text);
drop function if exists public.refund_success_time_v1(jsonb);
drop function if exists public.retire_split_attempt_v1(uuid, uuid);
drop function if exists public.whole_bill_card_open_v1(uuid, uuid[]);
drop function if exists public.unresolved_account_page_v1(uuid, uuid);
drop function if exists public.release_unreached_account_page_v1(uuid, uuid);
drop function if exists public.write_off_remainder_v1(uuid, uuid[], int, text, text, text, text, uuid, uuid);
drop function if exists public.guard_order_adjustment();
drop function if exists public.settle_split_slots_v1(uuid, uuid, text, int);
drop function if exists public.collect_split_slots_v1(uuid, uuid, int, int[], int, text, int, text, text, text);
drop function if exists public.close_divided_bill_v3(uuid);
drop function if exists public.reserve_split_slots_v1(uuid, uuid, int, uuid, int[], uuid);
drop function if exists public.release_split_slots_v1(uuid, uuid);
drop function if exists public.start_bill_split_v2(uuid, uuid, uuid, uuid, int, int, text, uuid, int);
drop function if exists public.resize_bill_split_v2(uuid, uuid, int, text, int);
drop function if exists public.cancel_bill_split_v2(uuid, uuid, int, text);
drop function if exists public.sitting_split_debt(uuid, uuid, uuid, timestamptz);
drop function if exists public.split_cents(int, int, int);
drop function if exists public.guard_split_checkout_slot();

drop function if exists public.sync_kitchen_ticket();
drop function if exists public.kitchen_items(jsonb);
drop function if exists public.sync_kitchen_request();

drop function if exists public.diner_checkout_open(jsonb);
drop function if exists public.diner_checkout_bind(uuid, jsonb);
drop function if exists public.finish_diner_checkout(uuid, boolean);
drop function if exists public.bind_diner_coupon() cascade;
drop function if exists public.bind_redemption_checkout() cascade;
drop function if exists public.save_promotion_v1(uuid, uuid, jsonb, jsonb);
drop function if exists public.duplicate_menu_v1(uuid, uuid);
drop function if exists public.enforce_offer_write();


drop function if exists public.track_ingredient_movement();
drop function if exists public.cutoff_ingredient_count();
drop function if exists public.record_ingredient_counts(uuid, jsonb, text);
drop function if exists public.waste_ingredient_usage(uuid, uuid, uuid, numeric);
drop function if exists public.sale_ingredient_usage(uuid, jsonb);
drop function if exists public.lock_ingredient_movements(uuid);

drop function if exists public.start_refund_due_fee(uuid, uuid, text, int);
drop function if exists public.stamp_refund_due_charge() cascade;
drop function if exists public.order_intent_result(uuid, uuid, text);
drop function if exists public.create_order_intent(uuid, uuid, text, jsonb, jsonb, boolean, int, jsonb);
drop function if exists public.create_cash_withdrawal_once(uuid, uuid, numeric, text, text, uuid);
drop function if exists public.record_purchase_once_v2(uuid, uuid, numeric, numeric, text, uuid);
drop function if exists public.record_purchase_once(uuid, uuid, numeric, numeric, text, uuid);
drop function if exists public.record_waste_once(uuid, uuid, uuid, numeric, text, text, numeric, text, uuid);
drop function if exists public.record_ingredient_counts_once(uuid, jsonb, text, uuid);
drop function if exists public.close_cash_shift_once(uuid, uuid, numeric, text, uuid);
drop function if exists public.open_cash_shift(uuid, text, numeric);

drop function if exists public.account_checkout_currency_v1(uuid, uuid, numeric, numeric, numeric, text) cascade;
drop function if exists public.account_settle_currency_v1(uuid, uuid, numeric, numeric, text, text, text, text) cascade;
drop function if exists public.collect_table_reviewed_v1(uuid,uuid,numeric,text,numeric,numeric,text,text,text) cascade;
drop function if exists public.save_product_addons_v1(uuid, uuid, uuid[], jsonb, uuid, uuid) cascade;
drop function if exists public.guard_recipe_choices() cascade;
drop function if exists public.waste_ingredient_usage_v2(uuid, uuid, uuid, numeric, jsonb);
drop function if exists public.record_waste(uuid, uuid, uuid, numeric, text, text, numeric, text, jsonb);
drop function if exists public.record_waste_once(uuid, uuid, uuid, numeric, text, text, numeric, text, uuid, jsonb);
drop function if exists public.retire_unsent_refund_attempt_v1(uuid, uuid, uuid, text);
