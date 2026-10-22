// ============================================================================
// The demo's card terminal: what its bank has already deposited.
//
// Whole days only, read in the restaurant's own calendar. The days older than
// four are marked deposited, the way a café that reconciles would have them —
// all to the peso but one that came in short and one never marked, so the
// deposits section has every state to show. And voucher numbers on a few of
// the terminal's payments, so a day opens onto references to match.
// ============================================================================

export async function seedTerminal(pg, rid) {
  const { rows: days } = await pg.query(
    `with r as (select timezone, terminal_fee_pct from restaurants where id = $1),
          d as (select (p.created_at at time zone r.timezone)::date as day, p.currency, p.amount
                  from payments p, r
                 where p.restaurant_id = $1 and p.method = 'card' and p.stripe_payment_intent is null)
     select d.day, d.currency, sum(d.amount) as takings, (select terminal_fee_pct from r) as fee_pct
       from d, r
      where d.day between (now() at time zone r.timezone)::date - 12 and (now() at time zone r.timezone)::date - 4
      group by d.day, d.currency order by d.day desc, d.currency`,
    [rid],
  );
  for (const [i, d] of days.entries()) {
    if (i === 2) continue; // never marked: it reads late
    const short = i === 1;
    // Marked the way the screen marks it, so each deposit carries the signed
    // manifest `pnpm money` reconciles. A direct insert had none, and every
    // demo deposit read as unsigned. The bank's figure is set afterwards.
    const { rows: [mark] } = await pg.query(
      `select record_terminal_deposit_v1($1, $2, $3, 0, $4, 'demo-manager@tabletap.dev') as result`,
      [rid, d.day, d.currency, short ? "Bank statement shows a chargeback" : null],
    );
    if (mark.result?.error) continue;
    await pg.query(
      `update terminal_deposits set received = greatest(0, expected - $4)
        where restaurant_id = $1 and sales_day = $2 and currency = $3`,
      [rid, d.day, d.currency, short ? 12.4 : 0],
    );
  }
  await pg.query(
    `update payments set terminal_ref = 'AUT ' || (100000 + (abs(hashtext(id::text)) % 900000))::text
      where id in (select id from payments where restaurant_id = $1 and method = 'card'
                     and stripe_payment_intent is null order by created_at desc limit 6)`,
    [rid],
  );
}
