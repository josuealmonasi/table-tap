-- Access predicates before the orders InitPlan fix. Kept as an independent
-- baseline so a changed role list cannot make both sides of the test agree.


create or replace function public.owns_restaurant(rid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  -- The founding owner (restaurants.owner_id) or a co-owner (staff role
  -- 'owner') — both hold full owner powers everywhere this is used.
  select exists (select 1 from restaurants r where r.id = rid and r.owner_id = auth.uid())
      or exists (select 1 from staff s
                 where s.restaurant_id = rid and s.user_id = auth.uid() and s.role = 'owner');
$$;

create or replace function public.works_at(rid uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select owns_restaurant(rid)
      or exists (select 1 from staff s where s.restaurant_id = rid and s.user_id = auth.uid());
$$;

create or replace function public.has_role(rid uuid, roles text[])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select owns_restaurant(rid)
      or exists (select 1 from staff s
                 where s.restaurant_id = rid and s.user_id = auth.uid() and s.role = any(roles));
$$;

create policy "team reads orders"
  on orders for select
  using (has_role(restaurant_id, array['manager', 'waiter', 'cashier']));

create policy "team reads service requests"
  on service_requests for select
  using (has_role(restaurant_id, array['manager', 'waiter', 'cashier']));

create policy "team updates service requests"
  on service_requests for update
  using (has_role(restaurant_id, array['manager', 'waiter', 'cashier']))
  with check (has_role(restaurant_id, array['manager', 'waiter', 'cashier']) and status in ('open', 'done'));

create policy "team reads kitchen tickets" on kitchen_tickets for select to authenticated
  using (works_at(restaurant_id));

create policy "team reads kitchen calls" on kitchen_requests for select to authenticated
  using (works_at(restaurant_id));
