export default async function cases(c, check) {
  const { db, restaurant, actor, value, order, table, coupon, card, state, outbox, pay, part, refused, id, assert } = c;
  await check('N1: a changed counter quote or currency writes no receipt or ticket choice', async () => {
    const sale = await order(), discount = await coupon(20);
    assert.equal(await value('select apply_bill_discount($1,$2::uuid[],$3,20) value', [restaurant, [sale], discount.id]), 'applied');
    const before = await state(sale);
    await refused(() => pay(sale, 100, 'MXN', true), /not_owed/);
    await refused(() => pay(sale, 80, 'USD', true), /not_owed/);
    assert.deepEqual(await state(sale), before);
    assert.equal(await value('select count(*)::int value from payments where restaurant_id=$1', [restaurant]), 0);
    assert.equal(await pay(sale, 80, 'MXN', true), 1);
    assert.equal(await value('select sum(amount)::float value from payments where restaurant_id=$1', [restaurant]), 80);
  });
  await check('N2: coupon minimum excludes the tip', async () => {
    const sale = await order(120, 20), discount = await coupon(10);
    await db.query('update coupons set min_subtotal=110 where id=$1', [discount.id]);
    assert.equal(await value('select apply_bill_discount($1,$2::uuid[],$3,10) value', [restaurant, [sale], discount.id]), 'changed');
    assert.equal((await state(sale)).total, 120);
    const request = id();
    await db.query(`insert into discount_requests(id,restaurant_id,order_ids,code,amount,requested_by)
      values($1,$2,$3::uuid[],$4,10,$5)`, [request, restaurant, [sale], discount.code, actor]);
    assert.equal(await value('select approve_discount_request_v2($1,$2,$3,10) value', [request, restaurant, actor]), 'changed');
    assert.equal((await state(sale)).total, 120);
  });
  await check('N2: a direct full food discount leaves the existing tip owed', async () => {
    const sale = await order(120, 20), discount = await coupon(100, 'percent');
    assert.equal(await value('select apply_bill_discount($1,$2::uuid[],$3,100) value', [restaurant, [sale], discount.id]), 'applied');
    assert.deepEqual(await state(sale), { paid: false, total: 20, tip: 20, discount: 100, ticket_email_skip: false });
  });
  await check('N2: an approved full food discount also preserves the tip', async () => {
    const sale = await order(120, 20), discount = await coupon(100, 'percent'), request = id();
    await db.query(`insert into discount_requests(id,restaurant_id,order_ids,code,amount,requested_by)
      values($1,$2,$3::uuid[],$4,100,$5)`, [request, restaurant, [sale], discount.code, actor]);
    assert.equal(await value('select approve_discount_request_v2($1,$2,$3,100) value', [request, restaurant, actor]), 'approved');
    assert.equal((await state(sale)).total, 20);
    assert.equal((await state(sale)).tip, 20);
  });
  await check('N2: discount shares follow food principal and sum to exact cents', async () => {
    const a = await order(30, 20), b = await order(50, 20), discount = await coupon(10);
    assert.equal(await value('select apply_bill_discount($1,$2::uuid[],$3,10) value', [restaurant, [a, b], discount.id]), 'applied');
    assert.equal((await state(a)).discount, 2.5);
    assert.equal((await state(b)).discount, 7.5);
    assert.equal((await state(a)).tip + (await state(b)).tip, 40);
  });
  await check('N7: counter skip stays with the successful collection and suppresses the outbox', async () => {
    const sale = await order(100, 0, {}, await card());
    await refused(() => pay(sale, 90, 'MXN', true), /not_owed/);
    assert.equal((await state(sale)).ticket_email_skip, false);
    assert.equal(await pay(sale, 100, 'MXN', true), 1);
    assert.equal((await state(sale)).paid, true);
    assert.equal((await state(sale)).ticket_email_skip, true);
    assert.equal(await outbox(sale), 0);
    await refused(() => pay(sale, 100, 'MXN', false), /not_owed/);
    assert.equal((await state(sale)).ticket_email_skip, true);
  });
  await check('N7: a refused or duplicate table collection cannot change its ticket choice', async () => {
    const f = await table(100, await card()), ref = id();
    assert.equal((await part(f, 100, 40, ref, true)).outcome, 'written');
    assert.equal((await state(f.orderId)).ticket_email_skip, true);
    assert.equal((await part(f, 100, 40, ref, false)).outcome, 'duplicate');
    assert.equal((await part(f, 100, 40, id(), false)).outcome, 'changed');
    assert.equal((await state(f.orderId)).ticket_email_skip, true);
    assert.equal((await part(f, 60, 60, id(), false)).outcome, 'written');
    assert.equal((await state(f.orderId)).ticket_email_skip, false);
    // The route closes already-covered orders through the deployed signature.
    assert.equal(await value("select settle_orders_v2($1,$2::uuid[],'cash',$3,'[]'::jsonb) value", [restaurant, [f.orderId], actor]), 1);
    assert.equal(await outbox(f.orderId), 1);
  });
};
