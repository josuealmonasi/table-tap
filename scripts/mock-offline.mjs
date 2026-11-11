import { randomUUID } from "node:crypto";

/** A legacy held receipt awaiting an honest manager attestation. No signed
 * collector proof is fabricated for a sale the demo never actually rang. */
export async function seedOffline(pg, restaurantId) {
  const posRef = randomUUID();
  const body = {
    posRef, restaurantId, method: "cash", currency: "MXN", noReceipt: true,
    items: [{ itemId: randomUUID(), name: "Coffee", price: 45, qty: 1, mods: {} }],
    offline: { at: new Date(Date.now() - 40 * 86_400_000).toISOString(), subtotal: 45, serviceFee: 0, tip: 0, discount: 0, total: 45 },
  };
  await pg.query(`insert into offline_sale_queue(restaurant_id,pos_ref,body,currency,submitted_by,reason)
    values($1,$2,$3::jsonb,'MXN','demo-cashier@tabletap.dev','apiErr.offlineTooOld')`, [restaurantId, posRef, JSON.stringify(body)]);
}

/** Two held receipts a manager resolved without a sale: one whose cash stayed
 * in the open drawer (an unclassified receipt, in the drawer and not in sales),
 * and one where nothing was collected. Resolved through the real function, so
 * the demo's audit rows are exactly what a manager's resolution writes. */
export async function seedResolvedOffline(pg, restaurantId) {
  const { rows: [owner] } = await pg.query(
    "select u.email from restaurants r join auth.users u on u.id = r.owner_id where r.id = $1", [restaurantId]);
  for (const [disposition, amount, reason] of [
    ["retained_cash", 60, "Receipt unreadable; the cash is in the drawer"],
    ["no_cash", 0, "Test sale, nothing was collected"],
  ]) {
    const posRef = randomUUID();
    const at = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const body = {
      posRef, restaurantId, method: "cash", currency: "MXN", noReceipt: true,
      items: [{ itemId: randomUUID(), name: "Coffee", price: amount, qty: 1, mods: {} }],
      offline: { at, subtotal: amount, serviceFee: 0, tip: 0, discount: 0, total: amount },
    };
    await pg.query(`insert into offline_sale_queue(restaurant_id,pos_ref,body,collector,currency,submitted_by,reason)
      values($1,$2,$3::jsonb,'demo-cashier@tabletap.dev','MXN','demo-cashier@tabletap.dev','apiErr.offlineTooOld')`,
      [restaurantId, posRef, JSON.stringify(body)]);
    await pg.query("select resolve_held_sale($1,$2,$3,$4,$5,'demo-cashier@tabletap.dev',$6,'MXN',$7)",
      [restaurantId, posRef, owner.email, reason, disposition, amount, at]);
  }
  // A seed that wrote nothing would leave the screens and gates with nothing to show.
  const { rows: [n] } = await pg.query(`select
      (select count(*)::int from held_sale_resolutions where restaurant_id = $1) resolutions,
      (select count(*)::int from held_cash_receipts where restaurant_id = $1) receipts`, [restaurantId]);
  if (n.resolutions !== 2 || n.receipts !== 1) throw new Error(`resolved held receipts not seeded: ${JSON.stringify(n)}`);
}
