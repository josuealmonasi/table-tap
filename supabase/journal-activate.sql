-- Transaction fragment: the production delta runs journal-lock.sql first,
-- then installs the new writers, then this file, and commits after it. No
-- inner COMMIT.
-- Every restaurant's money lock first, in id order, before any backfill row
-- lock or schema change. The locks are transaction-scoped and re-entrant, so
-- after journal-lock.sql this is a no-op; on its own (dev mock) it keeps the
-- same order.
do $$ declare r record; begin
  for r in select id from restaurants order by id loop
    perform public.lock_restaurant_money(r.id);
  end loop;
end $$;
-- Future restaurants, including those with no accounts yet, start from birth.
alter table restaurants alter column account_journal_started_at set default now();
-- Then activation, still in restaurant id order.
do $$ declare r record; begin
  for r in select id from restaurants order by id loop
    perform public.lock_restaurant_money(r.id);
    perform public.account_journal_backfill_v1(r.id, clock_timestamp());
    update restaurants set account_journal_started_at = now()
      where id = r.id and account_journal_started_at is null;
  end loop;
end $$;
