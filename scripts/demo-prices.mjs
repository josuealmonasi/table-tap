// The demo menu is priced on a small scale (a ramen at 13). feed-demo sets
// DEMO_PRICE_SCALE so the restaurant shown to a prospect charges what a
// Mexican restaurant does (that ramen at MX$195); every gate's dev seed keeps
// scale 1, so its fixtures and expected figures do not move.
export const PRICE_SCALE = Number(process.env.DEMO_PRICE_SCALE || 1);
/** True when feed-demo is seeding the presentation restaurant. */
export const FEED_DEMO = process.env.FEED_DEMO === "1";

/** A menu price on the demo's scale, rounded the way a menu is written. */
export function menuPrice(price) {
  if (PRICE_SCALE === 1) return price;
  const scaled = price * PRICE_SCALE;
  return scaled >= 50 ? Math.round(scaled / 5) * 5 : Math.round(scaled);
}

/** A supplier price on the demo's scale, to the cent. */
export function supplyPrice(price) {
  return Math.round(price * PRICE_SCALE * 100) / 100;
}
