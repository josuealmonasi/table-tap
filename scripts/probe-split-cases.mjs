export default async function cases(c, check) {
  const { db, restaurant, value, table, card, state, outbox, start, slot, id, assert } = c;
  await check('N5: disabling new splits leaves existing parts payable', async () => {
    const f = await table(), ref = id(), opened = await start(f, 100, ref);
    assert.equal(opened.outcome, 'started');
    await db.query('update restaurants set split_enabled=false where id=$1', [restaurant]);
    assert.equal((await start(f, 100, ref)).outcome, 'repeat');
    const fresh = await table();
    // audit #648: a disabled restaurant answers its own refusal, not 'forbidden'.
    assert.equal((await start(fresh, 100)).outcome, 'split_disabled');
    assert.equal((await slot(opened.split, [0], 5000, id(), false)).outcome, 'collected');
    assert.equal((await slot(opened.split, [1], 5000, id(), false)).outcome, 'collected');
    assert.equal((await state(f.orderId)).paid, true);
  });
  for (const finalSkip of [false, true]) {
    await check(`N7: only the successful last split collection decides its outbox (skip=${finalSkip})`, async () => {
      const f = await table(100, await card()), opened = await start(f, 100), ref = id();
      assert.equal(opened.outcome, 'started');
      assert.equal((await slot(opened.split, [0], 5000, ref, !finalSkip)).outcome, 'collected');
      assert.equal((await slot(opened.split, [0], 5000, ref, finalSkip)).outcome, 'duplicate');
      assert.equal((await slot(opened.split, [1], 5000, id(), finalSkip, 99)).outcome, 'stale');
      assert.equal((await state(f.orderId)).ticket_email_skip, !finalSkip);
      assert.equal((await slot(opened.split, [1], 5000, id(), finalSkip)).outcome, 'collected');
      assert.equal((await state(f.orderId)).paid, true);
      assert.equal((await state(f.orderId)).ticket_email_skip, finalSkip);
      assert.equal(await outbox(f.orderId), finalSkip ? 0 : 1);
    });
  }
  await check('N7: another restaurant cannot mark or collect this split', async () => {
    const f = await table(), opened = await start(f, 100), other = id();
    await db.query("insert into restaurants(id,name,plan,plan_status,currency) values($1,'Foreign follow-up probe','casa','active','MXN')", [other]);
    assert.equal((await slot(opened.split, [0], 5000, id(), true, 1, other)).outcome, 'gone');
    assert.equal((await state(f.orderId)).ticket_email_skip, false);
    assert.equal(await value('select count(*)::int value from payments where restaurant_id=$1', [restaurant]), 0);
  });
};
