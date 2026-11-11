-- PROPOSAL ONLY: Claude owns schema.sql and drop.sql. Not applied here.
-- Fold the column and function replacements into schema.sql; update drop.sql
-- for these new signatures (retain teardown of the old signatures for upgrades).
-- Deploy the schema before the route: it now sends p_purpose on both RPC paths.
-- Default 'other' keeps existing rows and old clients valid; do not infer a
-- purpose from historical free-text notes. No RLS or drawer arithmetic changes.
begin;

alter table public.cash_movements add column if not exists purpose text
  not null default 'other' check (purpose in ('tips', 'other'));

-- Remove the old overloads so PostgREST can resolve callers omitting purpose.
-- The new trailing default supports old route calls, including frozen retries.
drop function if exists public.create_cash_withdrawal(uuid, uuid, numeric, text, text);
drop function if exists public.create_cash_withdrawal_once(uuid, uuid, numeric, text, text, uuid);

create or replace function public.create_cash_withdrawal(p_restaurant uuid, p_shift uuid, p_amount numeric, p_note text, p_actor text, p_purpose text default 'other')
returns jsonb language plpgsql security definer set search_path = public as $$
declare s cash_shifts; v_id uuid;
begin
  perform public.lock_restaurant_money(p_restaurant);
  select * into s from cash_shifts where restaurant_id = p_restaurant and id = p_shift and closed_at is null for update;
  if not found then return null; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000 or p_amount <> round(p_amount, 2)
    or p_purpose is null or p_purpose not in ('tips', 'other')
    or nullif(btrim(p_actor), '') is null then raise exception 'invalid cash withdrawal'; end if;
  insert into cash_movements(restaurant_id, shift_id, currency, kind, amount, note, actor_email, purpose, created_at)
    values(p_restaurant, s.id, s.currency, 'withdrawal', p_amount, p_note, p_actor, p_purpose, clock_timestamp()) returning id into v_id;
  return jsonb_build_object('id', v_id, 'currency', s.currency);
end;
$$;
revoke all on function public.create_cash_withdrawal(uuid, uuid, numeric, text, text, text) from public, anon, authenticated;
grant execute on function public.create_cash_withdrawal(uuid, uuid, numeric, text, text, text) to service_role;

create or replace function public.create_cash_withdrawal_once(
  p_restaurant uuid, p_shift uuid, p_amount numeric, p_note text, p_actor text, p_ref uuid, p_purpose text default 'other'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare s cash_shifts; m cash_movements;
begin
  if p_purpose is null or p_purpose not in ('tips', 'other') then
    raise exception 'invalid cash withdrawal purpose';
  end if;
  perform public.lock_restaurant_money(p_restaurant);
  select * into m from cash_movements where restaurant_id = p_restaurant and request_ref = p_ref;
  if found then
    if (m.shift_id, m.amount, m.note, m.purpose) is distinct from (p_shift, p_amount, p_note, p_purpose) then
      raise exception 'reference belongs to another withdrawal' using errcode = 'PT409';
    end if;
    return jsonb_build_object('id', m.id, 'currency', m.currency);
  end if;
  select * into s from cash_shifts where restaurant_id = p_restaurant and id = p_shift and closed_at is null for update;
  if not found then return null; end if;
  if p_ref is null or p_amount is null or p_amount <= 0 or p_amount > 1000000 or p_amount <> round(p_amount, 2)
    or nullif(btrim(p_actor), '') is null then raise exception 'invalid cash withdrawal'; end if;
  insert into cash_movements(restaurant_id, shift_id, request_ref, currency, kind, amount, note, actor_email, purpose, created_at)
    values(p_restaurant, s.id, p_ref, s.currency, 'withdrawal', p_amount, p_note, p_actor, p_purpose, clock_timestamp())
    on conflict (shift_id, request_ref) where request_ref is not null do nothing returning * into m;
  if m.id is null then raise exception 'withdrawal reference changed' using errcode = 'PT409'; end if;
  return jsonb_build_object('id', m.id, 'currency', m.currency);
end;
$$;
revoke all on function public.create_cash_withdrawal_once(uuid, uuid, numeric, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.create_cash_withdrawal_once(uuid, uuid, numeric, text, text, uuid, text) to service_role;

create or replace function public.cash_shift_totals(p_restaurant uuid, p_shift uuid, p_until timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  with s as (
    select *, least(coalesce(closed_at, p_until), p_until) until_at
      from cash_shifts where id = p_shift and restaurant_id = p_restaurant
  ), receipts as (
    -- The tips inside those receipts, said apart so a shift can show what was
    -- takings and what belongs to the staff (sweep 10, finding 7).
    select coalesce(sum(p.amount), 0) amount, coalesce(sum(p.tip), 0) tip from payments p, s
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
    select coalesce(sum(m.amount), 0) amount,
      coalesce(sum(m.amount) filter (where m.purpose = 'tips'), 0) tips_out
      from cash_movements m, s
      where m.restaurant_id = p_restaurant and m.shift_id = s.id
        and m.kind = 'withdrawal' and m.currency = s.currency
  )
  select jsonb_build_object('opening', round(s.opening_amount, 2),
    'cashSales', round(r.amount - f.amount - h.amount, 2), 'tips', round(r.tip, 2), 'withdrawn', round(w.amount, 2),
    'tips_out', round(w.tips_out, 2),
    'expected', round(s.opening_amount + r.amount - f.amount - h.amount - w.amount, 2))
    from s cross join receipts r cross join returns f cross join old_returns h cross join withdrawals w;
$$;
revoke all on function public.cash_shift_totals(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.cash_shift_totals(uuid, uuid, timestamptz) to service_role;

commit;
