-- PROPOSAL ONLY: Claude reviews/folds into schema.sql. No database was touched.
-- Drop additions (before referenced checkouts/orders/restaurants):
/*
drop function if exists public.fail_stripe_dispute_event(uuid, uuid, text);
drop function if exists public.finish_stripe_dispute_event(uuid, uuid, jsonb, jsonb);
drop function if exists public.claim_stripe_dispute_event(uuid);
drop function if exists public.enqueue_stripe_dispute_event(text, boolean, text, text, text, text, timestamptz);
drop table if exists public.stripe_dispute_movements cascade;
drop table if exists public.stripe_dispute_events cascade;
drop table if exists public.stripe_disputes cascade;
*/
create unique index if not exists diner_checkouts_tenant_identity on diner_checkouts(restaurant_id, id);
create unique index if not exists account_checkouts_tenant_identity on account_checkouts(restaurant_id, id);

create table if not exists stripe_disputes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  stripe_account_id text not null,
  livemode boolean not null,
  stripe_dispute_id text not null,
  stripe_charge_id text not null,
  stripe_payment_intent text,
  order_id uuid,
  diner_checkout_id uuid,
  account_checkout_id uuid,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null,
  reason text not null,
  evidence_due_at timestamptz,
  provider_created_at timestamptz not null,
  verified_at timestamptz not null default now(),
  reconciliation_state text not null check (reconciliation_state in ('pending', 'review', 'reconciled')),
  last_error text,
  verified_transaction_ids text[] not null default '{}',
  unique (livemode, stripe_account_id, stripe_dispute_id),
  unique (restaurant_id, id, livemode, stripe_account_id),
  unique (id, livemode, stripe_account_id),
  foreign key (restaurant_id, order_id) references orders(restaurant_id, id),
  foreign key (restaurant_id, diner_checkout_id) references diner_checkouts(restaurant_id, id),
  foreign key (restaurant_id, account_checkout_id) references account_checkouts(restaurant_id, id),
  check (restaurant_id is not null or (order_id is null and diner_checkout_id is null and account_checkout_id is null))
);
create table if not exists stripe_dispute_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  stripe_account_id text not null,
  livemode boolean not null,
  stripe_dispute_id text not null,
  stripe_event_id text not null,
  event_type text not null check (event_type in ('charge.dispute.created', 'charge.dispute.updated',
    'charge.dispute.closed', 'charge.dispute.funds_withdrawn', 'charge.dispute.funds_reinstated')),
  provider_created_at timestamptz not null,
  created_at timestamptz not null default now(),
  state text not null default 'pending' check (state in ('pending', 'processing', 'error', 'done')),
  attempts integer not null default 0,
  last_error text,
  claim_token uuid,
  lease_until timestamptz,
  unique (livemode, stripe_account_id, stripe_event_id),
  unique (id, livemode, stripe_account_id),
  unique (restaurant_id, id, livemode, stripe_account_id)
);
create index if not exists dispute_events_pending on stripe_dispute_events(created_at, id) where state <> 'done';
create table if not exists stripe_dispute_movements (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id) on delete cascade,
  dispute_id uuid not null references stripe_disputes(id) on delete cascade,
  stripe_account_id text not null,
  livemode boolean not null,
  stripe_balance_transaction_id text not null,
  provider_type text not null,
  amount_minor bigint not null,
  fee_minor bigint not null,
  net_minor bigint not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  provider_created_at timestamptz not null,
  fee_details jsonb not null,
  first_event_id uuid not null,
  created_at timestamptz not null default now(),
  check (amount_minor - fee_minor = net_minor),
  unique (livemode, stripe_account_id, stripe_balance_transaction_id),
  foreign key (restaurant_id, dispute_id, livemode, stripe_account_id)
    references stripe_disputes(restaurant_id, id, livemode, stripe_account_id) on delete cascade,
  foreign key (dispute_id, livemode, stripe_account_id) references stripe_disputes(id, livemode, stripe_account_id),
  foreign key (restaurant_id, first_event_id, livemode, stripe_account_id) references stripe_dispute_events(restaurant_id, id, livemode, stripe_account_id),
  foreign key (first_event_id, livemode, stripe_account_id) references stripe_dispute_events(id, livemode, stripe_account_id)
);
create index if not exists dispute_movements_period on stripe_dispute_movements(restaurant_id, provider_created_at, id);
create index if not exists dispute_events_claim on stripe_dispute_events(livemode, stripe_account_id, stripe_dispute_id, lease_until) where state = 'processing';
-- Null-tenant cases are retained for platform review, never shown in tenant books.
-- Only the fenced finish writer may insert monetary evidence; it never updates it.
alter table stripe_disputes enable row level security;
alter table stripe_dispute_movements enable row level security;
alter table stripe_dispute_events enable row level security;
revoke all on stripe_disputes, stripe_dispute_movements, stripe_dispute_events from public, anon, authenticated;
grant select on stripe_disputes, stripe_dispute_movements, stripe_dispute_events to service_role;

create or replace function public.enqueue_stripe_dispute_event(
  p_account text, p_live boolean, p_event text, p_dispute text, p_intent text, p_type text, p_created timestamptz
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_restaurant uuid; v_tenants integer;
begin
  select count(distinct restaurant_id), min(restaurant_id::text)::uuid into v_tenants, v_restaurant from (
    select restaurant_id from diner_checkouts where stripe_account_id = p_account and livemode = p_live and stripe_payment_intent = p_intent
    union select restaurant_id from payments where stripe_account_id = p_account and stripe_payment_intent = p_intent
  ) provenance;
  if v_tenants = 0 then select id into v_restaurant from restaurants where stripe_account_id = p_account;
  elsif v_tenants > 1 then v_restaurant := null; end if;
  -- The FK takes a key-share lock against deletion. Historical attribution is
  -- resolved from the provider's PI by the worker; this is only discovery.
  insert into stripe_dispute_events(restaurant_id, stripe_account_id, livemode, stripe_event_id,
    stripe_dispute_id, event_type, provider_created_at)
  values (v_restaurant, p_account, p_live, p_event, p_dispute, p_type, p_created)
  on conflict (livemode, stripe_account_id, stripe_event_id) do nothing;
  select id into strict v_id from stripe_dispute_events where livemode = p_live
    and stripe_account_id = p_account and stripe_event_id = p_event and stripe_dispute_id = p_dispute;
  return v_id;
end $$;

create or replace function public.claim_stripe_dispute_event(p_event uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e stripe_dispute_events;
begin
  select * into e from stripe_dispute_events where id = p_event;
  if not found then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(e.stripe_account_id || ':' || e.livemode || ':' || e.stripe_dispute_id, 0));
  if exists (select 1 from stripe_dispute_events where stripe_account_id = e.stripe_account_id
    and livemode = e.livemode and stripe_dispute_id = e.stripe_dispute_id
    and state = 'processing' and lease_until > now()) then return null; end if;
  update stripe_dispute_events set state = 'processing', attempts = attempts + 1,
    claim_token = gen_random_uuid(), lease_until = now() + interval '2 minutes'
    where id = p_event and state <> 'done' returning * into e;
  if not found then return null; end if;
  return to_jsonb(e);
end $$;

create or replace function public.finish_stripe_dispute_event(p_event uuid, p_claim uuid, p_case jsonb, p_movements jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
declare e stripe_dispute_events; v_id uuid; v_restaurant uuid; v_state text; m jsonb; v_ids text[]; v_waiting boolean;
begin
  select * into e from stripe_dispute_events where id = p_event;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(e.stripe_account_id || ':' || e.livemode || ':' || e.stripe_dispute_id, 0));
  v_restaurant := (p_case->>'restaurant_id')::uuid;
  -- Same lock order as admin_delete_restaurant, then a key-share FK lock.
  if v_restaurant is not null then
    perform lock_restaurant_money(v_restaurant);
    perform 1 from restaurants where id = v_restaurant for key share;
    if not found then raise exception 'Dispute restaurant disappeared'; end if;
  end if;
  select * into e from stripe_dispute_events where id = p_event for update;
  if e.claim_token is distinct from p_claim or e.state <> 'processing' or e.lease_until <= now() then return false; end if;
  update stripe_dispute_events set restaurant_id = v_restaurant where id = e.id;
  select coalesce(array_agg(x->>'stripe_balance_transaction_id' order by x->>'stripe_balance_transaction_id'), '{}'),
    exists (select 1 from jsonb_array_elements(p_movements) t group by t->>'currency'
      having sum((t->>'amount_minor')::bigint) < 0) into v_ids, v_waiting from jsonb_array_elements(p_movements) x;
  if cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then raise exception 'Duplicate dispute evidence'; end if;
  v_state := case when v_restaurant is null or not (p_case->>'matched')::boolean then 'review'
    when (p_case->>'status' = 'won' and v_waiting)
      or (p_case->>'status' not in ('warning_needs_response', 'warning_under_review', 'warning_closed', 'prevented')
        and cardinality(v_ids) = 0) then 'pending' else 'reconciled' end;
  insert into stripe_disputes(restaurant_id, stripe_account_id, livemode, stripe_dispute_id,
    stripe_charge_id, stripe_payment_intent, order_id, diner_checkout_id, account_checkout_id,
    amount_minor, currency, status, reason, evidence_due_at, provider_created_at, reconciliation_state, verified_transaction_ids)
  values (v_restaurant, e.stripe_account_id, e.livemode, e.stripe_dispute_id, p_case->>'stripe_charge_id',
    p_case->>'stripe_payment_intent', (p_case->>'order_id')::uuid, (p_case->>'diner_checkout_id')::uuid,
    (p_case->>'account_checkout_id')::uuid, (p_case->>'amount_minor')::bigint, p_case->>'currency',
    p_case->>'status', p_case->>'reason', (p_case->>'evidence_due_at')::timestamptz,
    (p_case->>'provider_created_at')::timestamptz, v_state, v_ids)
  on conflict (livemode, stripe_account_id, stripe_dispute_id) do update set
    restaurant_id = excluded.restaurant_id, stripe_payment_intent = excluded.stripe_payment_intent,
    order_id = excluded.order_id, diner_checkout_id = excluded.diner_checkout_id, account_checkout_id = excluded.account_checkout_id,
    status = excluded.status, reason = excluded.reason, evidence_due_at = excluded.evidence_due_at,
    verified_at = now(), reconciliation_state = excluded.reconciliation_state, last_error = null,
    verified_transaction_ids = excluded.verified_transaction_ids
  -- Never silently move an attributed charge to another restaurant or currency.
  where (stripe_disputes.restaurant_id is null or stripe_disputes.restaurant_id = excluded.restaurant_id)
    and stripe_disputes.stripe_charge_id = excluded.stripe_charge_id
    and stripe_disputes.amount_minor = excluded.amount_minor and stripe_disputes.currency = excluded.currency
  returning id into v_id;
  if v_id is null then raise exception 'Conflicting dispute identity'; end if;
  if exists (select 1 from stripe_dispute_movements where dispute_id = v_id
    and not (stripe_balance_transaction_id = any(v_ids))) then raise exception 'Provider omitted recorded dispute evidence'; end if;
  -- Attribution may become known after an initially unowned discovery. Only
  -- null attribution can be filled; signed money and provider identity stay fixed.
  update stripe_dispute_events set restaurant_id = v_restaurant where restaurant_id is null
    and livemode = e.livemode and stripe_account_id = e.stripe_account_id and stripe_dispute_id = e.stripe_dispute_id;
  update stripe_dispute_movements set restaurant_id = v_restaurant where dispute_id = v_id and restaurant_id is null;
  for m in select * from jsonb_array_elements(p_movements) loop
    insert into stripe_dispute_movements(restaurant_id, dispute_id, stripe_account_id, livemode,
      stripe_balance_transaction_id, provider_type, amount_minor, fee_minor, net_minor, currency,
      provider_created_at, fee_details, first_event_id)
    values (v_restaurant, v_id, e.stripe_account_id, e.livemode, m->>'stripe_balance_transaction_id', m->>'provider_type',
      (m->>'amount_minor')::bigint, (m->>'fee_minor')::bigint, (m->>'net_minor')::bigint, m->>'currency',
      (m->>'provider_created_at')::timestamptz, m->'fee_details', e.id)
    on conflict (livemode, stripe_account_id, stripe_balance_transaction_id) do nothing;
    if not exists (select 1 from stripe_dispute_movements t where t.livemode = e.livemode
      and t.stripe_account_id = e.stripe_account_id and t.stripe_balance_transaction_id = m->>'stripe_balance_transaction_id'
      and t.dispute_id = v_id and t.restaurant_id is not distinct from v_restaurant
      and t.amount_minor = (m->>'amount_minor')::bigint and t.fee_minor = (m->>'fee_minor')::bigint
      and t.net_minor = (m->>'net_minor')::bigint and t.currency = m->>'currency'
      and t.provider_type = m->>'provider_type' and t.fee_details = m->'fee_details'
      and t.provider_created_at = (m->>'provider_created_at')::timestamptz) then
      raise exception 'Conflicting immutable dispute transaction';
    end if;
  end loop;
  update stripe_dispute_events set restaurant_id = v_restaurant,
    state = case when v_state = 'reconciled' then 'done' else 'pending' end,
    claim_token = null, lease_until = null, last_error = null where id = e.id;
  return v_state = 'reconciled';
end $$;

create or replace function public.fail_stripe_dispute_event(p_event uuid, p_claim uuid, p_error text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update stripe_dispute_events set state = 'error', last_error = left(p_error, 1000), claim_token = null, lease_until = null
    where id = p_event and claim_token = p_claim and state = 'processing';
end $$;
revoke all on function public.enqueue_stripe_dispute_event(text, boolean, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_stripe_dispute_event(uuid) from public, anon, authenticated;
revoke all on function public.finish_stripe_dispute_event(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.fail_stripe_dispute_event(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.enqueue_stripe_dispute_event(text, boolean, text, text, text, text, timestamptz) to service_role;
grant execute on function public.claim_stripe_dispute_event(uuid) to service_role;
grant execute on function public.finish_stripe_dispute_event(uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.fail_stripe_dispute_event(uuid, uuid, text) to service_role;

-- Replacement deletion writer: all three dispute tables join the accounting archive.
create or replace function public.admin_delete_restaurant(p_restaurant uuid, p_check_only boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_table text;
  v_refund_unlock_at timestamptz;
begin
  perform public.lock_restaurant_money(p_restaurant);
  -- FK inserts take a key-share lock here. Once held, no new receipt or
  -- obligation can arrive between these checks and the cascading deletion.
  perform 1 from restaurants where id = p_restaurant for update;
  if not found then return jsonb_build_object('outcome', 'gone'); end if;
  -- Keep recovery and live cases until both outcome and balance evidence settle.
  if exists (select 1 from stripe_disputes where restaurant_id = p_restaurant
      and (reconciliation_state <> 'reconciled' or status not in ('won', 'lost', 'warning_closed', 'prevented')))
    or exists (select 1 from stripe_dispute_events e where e.state <> 'done' and (
      e.restaurant_id = p_restaurant
      or e.stripe_account_id in (select stripe_account_id from restaurants where id = p_restaurant)
      or e.stripe_account_id in (select stripe_account_id from diner_checkouts where restaurant_id = p_restaurant)
      or e.stripe_account_id in (select stripe_account_id from payments where restaurant_id = p_restaurant)
    )) then return jsonb_build_object('outcome', 'dispute'); end if;
  -- Stripe can fail a refund after first reporting success. Keep the live
  -- restaurant and its recovery path for 30 days after the latest evidence.
  -- Attempts count too: another finish may have refreshed their success.
  select max(refunded_at) + interval '30 days' into v_refund_unlock_at
  from (
    select completed_at as refunded_at from refund_operations
      where restaurant_id = p_restaurant and source = 'stripe' and status = 'succeeded'
    union all
    select refunded_at from refunds_due
      where restaurant_id = p_restaurant and refunded_at is not null
    union all
    select updated_at as refunded_at from refund_attempts
      where restaurant_id = p_restaurant and provider_status = 'succeeded'
    union all
    select updated_at as refunded_at from refund_due_attempts
      where restaurant_id = p_restaurant and provider_status = 'succeeded'
  ) refunds;
  if v_refund_unlock_at > now() then
    return jsonb_build_object('outcome', 'refundWindow', 'unlock_at', v_refund_unlock_at);
  end if;
  if exists (select 1 from refund_operations where restaurant_id = p_restaurant and status <> 'succeeded') then
    return jsonb_build_object('outcome', 'refund');
  end if;
  if exists (select 1 from refunds_due where restaurant_id = p_restaurant and refunded_at is null) then
    return jsonb_build_object('outcome', 'refundDue');
  end if;
  if exists (select 1 from refund_attempts where restaurant_id = p_restaurant
      and (provider_status is null or provider_status not in ('succeeded', 'failed', 'canceled', 'never_sent')))
    or exists (select 1 from refund_due_attempts where restaurant_id = p_restaurant
      and (provider_status is null or provider_status not in ('succeeded', 'failed', 'canceled')))
    or exists (select 1 from diner_checkouts where restaurant_id = p_restaurant and status = 'open')
    or exists (select 1 from account_checkouts where restaurant_id = p_restaurant and status = 'open')
    or exists (select 1 from platform_fees where restaurant_id = p_restaurant and status = 'open')
    or exists (select 1 from fee_returns where restaurant_id = p_restaurant and status in ('prepared', 'dispatched', 'unresolved'))
    or exists (select 1 from fee_reconcile_queue where restaurant_id = p_restaurant) then
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
  -- receipts disposable, but completed books past the refund window must not
  -- prevent its deletion.
  if p_check_only is distinct from false then return jsonb_build_object('outcome', 'ready'); end if;
  foreach v_table in array array[
    'stripe_disputes', 'stripe_dispute_movements', 'stripe_dispute_events',
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
