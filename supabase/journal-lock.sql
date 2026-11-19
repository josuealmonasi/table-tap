-- Transaction fragment: the FIRST statement of the production delta, right
-- after BEGIN and before any schema change. It takes every restaurant's money
-- lock in restaurant id order, the order every money writer uses, so the
-- delta's table locks can never be waited on by a transaction that already
-- holds a money lock the delta is about to wait for. No inner COMMIT.
do $$ declare r record; begin
  for r in select id from restaurants order by id loop
    perform public.lock_restaurant_money(r.id);
  end loop;
end $$;
