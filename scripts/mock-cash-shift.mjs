/** Sign the historical demo shift only after all its receipts have been seeded. */
export async function finalizeMockCashShift(pg, restaurantId, shiftId) {
  // The review totals include offline receipts that arrived later. Those were
  // absent when this historical count was signed, so leave them in its trail.
  await pg.query(
    `with signed as (
       select s.id, (cash_shift_totals(s.restaurant_id, s.id, s.closed_at)->>'expected')::numeric
         - coalesce((select sum(p.amount) from payments p
             where p.restaurant_id = s.restaurant_id and p.currency = s.currency
               and p.method = 'cash' and nullif(p.actor_email, '') is not null
               and p.created_at between s.opened_at and s.closed_at
               and p.recorded_at > s.closed_at), 0) as expected
         from cash_shifts s
        where s.restaurant_id = $1 and s.id = $2 and s.closed_at is not null
     )
     update cash_shifts s set expected_cash = signed.expected,
       counted_cash = signed.expected - 20, difference = -20
       from signed where s.id = signed.id`,
    [restaurantId, shiftId],
  );
}
