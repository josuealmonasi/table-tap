-- Transaction fragment: install the new writers BEFORE this file and commit
-- AFTER it, in the same production delta transaction. No inner COMMIT.
do $$ declare r record; begin
  for r in select id from restaurants order by id loop
    perform public.lock_restaurant_money(r.id);
    perform public.account_journal_backfill_v1(r.id, clock_timestamp());
    update restaurants set account_journal_started_at = now()
      where id = r.id and account_journal_started_at is null;
  end loop;
end $$;
-- Future restaurants, including those with no accounts yet, start from birth.
alter table restaurants alter column account_journal_started_at set default now();
