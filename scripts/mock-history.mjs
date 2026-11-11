// ============================================================================
// Two months of a restaurant's back office for the presentation demo
// (feed-demo only): a closed register shift (corte) every day, the odd cash
// withdrawal, weekly supplier deliveries sized to what the menu actually used,
// and waste. Runs after the seeder's orders exist, because deliveries follow
// what was sold and each day's corte counts that day's cash.
// ============================================================================
import { supplyPrice } from "./demo-prices.mjs";

const DAYS = 60;
const CASHIERS = ["demo-cashier@tabletap.dev", "demo-manager@tabletap.dev"];
const pick = list => list[Math.floor(Math.random() * list.length)];

/** One closed shift per day, 08:30 to 23:00 in the restaurant's zone, ending before the seeder's own two. */
async function seedDailyShifts(pg, rid) {
  const { rows: [{ tz }] } = await pg.query(
    "select coalesce(timezone, 'America/Mexico_City') tz from restaurants where id = $1", [rid]);
  const { rows: [{ first }] } = await pg.query(
    "select min(opened_at) first from cash_shifts where restaurant_id = $1", [rid]);
  let shifts = 0;
  for (let back = DAYS; back >= 1; back--) {
    const { rows: [window] } = await pg.query(
      `select (date_trunc('day', now() at time zone $1) - make_interval(days => $2) + interval '8 hours 30 minutes') at time zone $1 opened_at,
              (date_trunc('day', now() at time zone $1) - make_interval(days => $2) + interval '23 hours') at time zone $1 closed_at`,
      [tz, back]);
    // Never into the seeder's own shifts, which end the history.
    if (first && new Date(window.closed_at) >= new Date(first)) continue;
    const who = pick(CASHIERS);
    const { rows: [shift] } = await pg.query(
      `insert into cash_shifts (restaurant_id, opened_by, opened_at, opening_amount)
       values ($1, $2, $3, 1000) returning id`, [rid, who, window.opened_at]);
    if (Math.random() < 0.3) {
      const [note, amount] = pick([["Compra de hielo", 180], ["Pago al proveedor de verduras", 420],
        ["Gas para la cocina", 350], ["Propinas repartidas al equipo", 600], ["Garrafones de agua", 140]]);
      await pg.query(
        `insert into cash_movements (restaurant_id, kind, amount, note, actor_email, shift_id, created_at)
         values ($1, 'withdrawal', $2, $3, $4, $5, $6::timestamptz + interval '6 hours')`,
        [rid, amount, note, who, shift.id, window.opened_at]);
    }
    // Signed as the till would have: expected from the books at close, minus
    // cash recorded after it (the seeder's late offline receipts), and a count
    // that is right most nights and a little off on a few.
    const diff = pick([0, 0, 0, 0, 0, 0, -20, 10, -50]);
    await pg.query(
      `with signed as (
         select (cash_shift_totals($1, $2, $3)->>'expected')::numeric
           - coalesce((select sum(p.amount) from payments p, cash_shifts s
               where s.id = $2 and p.restaurant_id = $1 and p.currency = s.currency
                 and p.method = 'cash' and nullif(p.actor_email, '') is not null
                 and p.created_at between s.opened_at and $3 and p.recorded_at > $3), 0) expected
       )
       update cash_shifts set closed_at = $3, closed_by = $4, expected_cash = signed.expected,
         counted_cash = greatest(0, signed.expected + $5), difference = greatest(0, signed.expected + $5) - signed.expected,
         difference_note = case when $5 < 0 then 'Faltante al cierre, se revisó con el equipo'
                                when $5 > 0 then 'Sobrante: cambio que no se entregó' end,
         explained_by = case when $5 <> 0 then $4 end
       from signed where cash_shifts.id = $2`,
      [rid, shift.id, window.closed_at, who, diff]);
    shifts++;
  }
  return shifts;
}

/** Weekly deliveries for every ingredient the menu used, sized to two months of sales plus a margin. */
async function seedDeliveries(pg, rid) {
  const { rows } = await pg.query(
    `select i.id, i.pack_size, i.pack_price, coalesce(sum(-m.quantity), 0) used
       from ingredients i left join ingredient_movements m on m.ingredient_id = i.id and m.kind = 'sale'
      where i.restaurant_id = $1 group by i.id`, [rid]);
  let deliveries = 0;
  for (const i of rows) {
    const weekly = Number(i.used) / (DAYS / 7);
    if (weekly <= 0) continue;
    const packs = Math.max(1, Math.ceil((weekly * 1.12) / Number(i.pack_size)));
    for (let week = DAYS / 7 - 1; week >= 0; week--) {
      const days = Math.round(week * 7 + 6 + Math.random());
      await pg.query(
        `insert into ingredient_purchases (restaurant_id, ingredient_id, quantity, total, recorded_by, created_at)
         values ($1, $2, $3, $4, 'demo-manager@tabletap.dev', now() - make_interval(days => $5))`,
        [rid, i.id, packs * Number(i.pack_size), Math.round(packs * Number(i.pack_price) * 100) / 100, days]);
      deliveries++;
    }
  }
  return deliveries;
}

/** A couple of waste entries a week, every reason, costed at the ingredient's price. */
async function seedWaste(pg, rid) {
  const { rows: ingredients } = await pg.query(
    "select id, name, unit, pack_size, pack_price from ingredients where restaurant_id = $1 and unit <> 'pza'", [rid]);
  let entries = 0;
  for (let back = DAYS; back >= 2; back -= 3 + Math.floor(Math.random() * 3)) {
    const i = pick(ingredients);
    const quantity = Math.round(Number(i.pack_size) * (0.05 + Math.random() * 0.15));
    const cost = Math.round(quantity * Number(i.pack_price) / Number(i.pack_size) * 100) / 100;
    await pg.query(
      `insert into waste_entries (restaurant_id, ingredient_id, name, quantity, reason, cost, recorded_by, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, now() - make_interval(days => $8))`,
      [rid, i.id, i.name, quantity, pick(["spoiled", "spoiled", "mistake", "unsold", "staff"]), cost,
        pick(["demo-kitchen@tabletap.dev", "demo-manager@tabletap.dev"]), back]);
    entries++;
  }
  return entries;
}

/** The back office's two months. Returns what it wrote, for feed-demo's summary. */
export async function seedHistory(pg, rid) {
  const shifts = await seedDailyShifts(pg, rid);
  const deliveries = await seedDeliveries(pg, rid);
  const waste = await seedWaste(pg, rid);
  return { shifts, deliveries, waste, supplyScale: supplyPrice(1) };
}
