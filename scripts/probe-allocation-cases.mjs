export default async function cases(c, check) {
  const { db, restaurant, actor, value, order, id, assert } = c;
  const projection = payment => value(`select jsonb_build_object(
    'version',p.allocation_version,'quality',p.allocation_quality,'origin',p.allocation_origin,
    'amount',p.unallocated_amount,'tip',p.unallocated_tip,'currency',p.currency,
    'unknown',p.breakdown_unknown,'reason',p.allocation_reason,
    'scope_count',cardinality(p.allocation_scope),
    'allocations',(select jsonb_agg(jsonb_build_object('amount',a.amount,'tip',a.tip,'provenance',a.provenance)
      order by a.amount,a.tip) from payment_allocations a where a.payment_id=p.id)) value
    from payments p where p.id=$1 and p.restaurant_id=$2`, [payment, restaurant]);
  for (const sample of [{ total: 100, tip: 0, status: 'completed' },
    { total: 120, tip: 20, status: 'completed' }, { total: 100, tip: 0, status: 'cancelled' }]) {
    await check(`seed allocations equal actual legacy backfill (${sample.status}, tip=${sample.tip})`, async () => {
      const seededOrder = await order(sample.total, sample.tip, {}, null, sample.status, true);
      const legacyOrder = await order(sample.total, sample.tip, {}, null, sample.status, true);
      await db.query("select set_config('tabletap.allocation_writer','',true),set_config('tabletap.allocation_origin','fixture_history',true)");
      const seeded = await value(`insert into payments(restaurant_id,order_id,amount,tip,method,actor_email)
        values($1,$2,$3,0,'cash',$4) returning id value`, [restaurant, seededOrder, sample.total, actor]);
      const before = await projection(seeded);
      assert.equal(before.version, 1);
      assert.equal(before.unknown, sample.tip !== 0);
      await db.query("select set_config('tabletap.allocation_origin','',true)");
      const legacy = await value(`insert into payments(restaurant_id,order_id,amount,tip,method,actor_email)
        values($1,$2,$3,0,'cash',$4) returning id value`, [restaurant, legacyOrder, sample.total, actor]);
      await value('select backfill_payment_allocations($1) value', [restaurant]);
      assert.deepEqual(await projection(legacy), before);
      assert.deepEqual(await projection(seeded), before);
      assert.equal(await value('select payment_allocations_need_backfill($1) value', [restaurant]), false);
      // A new matching historical log is not skipped; another tenant's log
      // cannot turn this restaurant's read back into a writer.
      if (sample.status === 'cancelled') {
        const other = id(), log = id();
        await db.query("insert into restaurants(id,name,plan_status) values($1,'Foreign evidence probe','active')", [other]);
        const detail = `order=${seededOrder.slice(0, 8)} amount=${sample.total.toFixed(2)} method=cash collector=${actor}`;
        await db.query("insert into user_logs(id,restaurant_id,actor_email,entity,action,detail) values($1,$2,$3,'order','refunded',$4)",
          [log, other, actor, detail]);
        assert.equal(await value('select payment_allocations_need_backfill($1) value', [restaurant]), false);
        await db.query("insert into user_logs(restaurant_id,actor_email,entity,action,detail) values($1,$2,'order','refunded',$3)",
          [restaurant, actor, detail]);
        assert.equal(await value('select payment_allocations_need_backfill($1) value', [restaurant]), true);
        await value('select backfill_payment_allocations($1) value', [restaurant]);
        assert.equal(await value('select payment_allocations_need_backfill($1) value', [restaurant]), false);
      }
    });
  }
  await check('N13: the generated decision clock orders tenant-scoped pages with stable ties', async () => {
    const refs = [id(), id(), id()].sort(), stamp = new Date(Date.now() - 3600_000), received = new Date(Date.now() - 7200_000);
    const other = id();
    await db.query("insert into restaurants(id,name,plan_status) values($1,'Foreign history probe','active')", [other]);
    await db.query(`insert into offline_sale_queue(restaurant_id,pos_ref,body,submitted_by,reason,approved_at)
      values($1,$2,'{}',$3,'probe',now())`, [other, id(), actor]);
    for (const [index, ref] of refs.entries()) {
      await db.query(`insert into offline_sale_queue(restaurant_id,pos_ref,body,submitted_by,reason,received_at,approved_at,resolved_at)
        values($1,$2,'{}',$3,'probe',$4,$5,$6)`, [restaurant, ref, actor, received, index === 1 ? null : stamp, index === 1 ? stamp : null]);
    }
    const page = (offset, limit) => db.query(`select pos_ref,decision_at from offline_sale_queue where restaurant_id=$1
      and decision_at is not null order by decision_at desc,pos_ref limit $2 offset $3`, [restaurant, limit, offset]);
    const a = (await page(0, 2)).rows, b = (await page(2, 2)).rows;
    assert.deepEqual([...a, ...b].map(row => row.pos_ref), refs);
    assert.ok([...a, ...b].every(row => row.decision_at.toISOString() === stamp.toISOString()));
    const expression = await value(`select pg_get_expr(adbin,adrelid) value from pg_attrdef d join pg_attribute a
      on a.attrelid=d.adrelid and a.attnum=d.adnum where d.adrelid='offline_sale_queue'::regclass and a.attname='decision_at'`);
    assert.match(expression, /GREATEST\(approved_at, resolved_at\)/i);
  });
};
