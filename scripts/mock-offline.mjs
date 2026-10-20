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
