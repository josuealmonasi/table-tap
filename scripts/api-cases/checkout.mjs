import { MARK } from "../api-fixtures.mjs";

export function checkoutCardCases(fx) {
  const { restaurant, dish } = fx;
  const r = restaurant.id;
  return [
    { name: "POST /api/checkout (card)", as: "diner", method: "POST", path: "/api/checkout",
      // With no Stripe account connected the healthy answer is 409, not a 500.
      //
      // Three of them, not one: Stripe will not take a card payment under
      // MX$10, and the cheapest dish on the demo menu is MX$6.50. At qty 1
      // this case was testing Stripe's floor rather than our checkout, and
      // whether it passed depended on which dish the fixture happened to pick.
      body: { restaurantId: r, tableId: null, note: MARK, items: [{ itemId: dish.id,
        name: dish.name, price: Number(dish.price), qty: 3, emoji: "🍽️", mods: {} }] },
      expect: [200, 409] },
    // And the card path itself, which the case above has never reached: with
    // no connected account it is turned away at the door, so the line items,
    // the name trimming and the cart cap that #333 added have never been built
    // for a real session. A fake account gets all the way to Stripe and fails
    // there, and failing THERE is the assertion.
    { name: "POST /api/checkout (card, reaches Stripe)", as: "diner", method: "POST",
      path: "/api/checkout", arrange: f => f.withCardReader(),
      body: { restaurantId: r, tableId: null, note: MARK, items: [{ itemId: dish.id,
        name: dish.name, price: Number(dish.price), qty: 3, emoji: "🍽️", mods: {} }] },
      expect: [500], expectError: /pago falló|payment failed/i,
      // Its fee was reserved under the month's ceiling before Stripe was
      // asked; Stripe refused the session, so it has to be given back — an
      // open reservation would count a fee nobody will ever pay. The released
      // row is removed after, like everything else a case leaves.
      effect: async f => {
        const since = new Date(Date.now() - 120_000).toISOString();
        const { data } = await f.admin.from("platform_fees").select("id, status")
          .eq("restaurant_id", r).eq("source", "order").gte("created_at", since);
        const rows = data ?? [];
        await f.admin.from("platform_fees").delete().in("id", rows.filter(x => x.status === "released").map(x => x.id));
        return (rows.some(x => x.status === "released") && !rows.some(x => x.status === "open"))
          || `the fee it reserved was left ${JSON.stringify(rows.map(x => x.status))}`;
      } },
    // A charge that fails must give the coupon use back. It is reserved before
    // Stripe is called — so a coupon on its last use cannot be spent twice by
    // two diners at once — and a reservation nobody releases burns that use
    // for a sale which never happened, quietly, on the one coupon a restaurant
    // printed a hundred of.
    { name: "POST /api/checkout (a failed charge gives back what it reserved)", as: "diner",
      method: "POST", path: "/api/checkout",
      // Both switches, and both undone afterwards. `undoClaim` releases the
      // coupon AND the stock, and until now only the coupon half was watched —
      // a charge that never happened quietly emptying the shelf would have
      // gone unnoticed.
      arrange: async f => {
        const putReaderBack = await f.withCardReader();
        const putStockBack = await f.withStock(20);
        return async () => { await putStockBack(); await putReaderBack(); };
      },
      body: async f => {
        const { data } = await f.admin
          .from("coupons").select("uses_count").eq("id", f.cardCouponId).maybeSingle();
        f.couponUsesBefore = data?.uses_count ?? 0;
        return {
          restaurantId: r, tableId: null, note: MARK, couponCode: f.cardCouponCode,
          items: [{ itemId: dish.id, name: dish.name, price: Number(dish.price),
                    qty: 5, emoji: "🍽️", mods: {} }],
        };
      },
      expect: [500], expectError: /pago falló|payment failed/i,
      effect: async f => {
        const { data } = await f.admin
          .from("coupons").select("uses_count").eq("id", f.cardCouponId).maybeSingle();
        if (data?.uses_count !== f.couponUsesBefore) {
          return `the coupon went from ${f.couponUsesBefore} uses to ${data?.uses_count} on a sale that never happened`;
        }
        const { data: item } = await f.admin
          .from("menu_items").select("stock").eq("id", f.dish.id).maybeSingle();
        return item?.stock === 20
          ? true
          : `the shelf went from 20 to ${item?.stock} on a sale that never happened`;
      } },
  ];
}

export function checkoutCounterCases(fx) {
  const { restaurant, dish, paidOrder } = fx;
  const r = restaurant.id;
  return [
    // The same promise for a refusal that comes before any charge. The table
    // is checked after the coupon is claimed, and that answer once returned
    // without handing the use back: a code with a limit could be spent down
    // to nothing by asking for a table that is not this restaurant's, and a
    // diner whose table was deleted while they ordered lost one quietly.
    { name: "POST /api/checkout (a table that is not here gives back the coupon)", as: "diner",
      method: "POST", path: "/api/checkout",
      body: async f => {
        const { data } = await f.admin
          .from("coupons").select("uses_count").eq("id", f.cardCouponId).maybeSingle();
        f.couponUsesBefore = data?.uses_count ?? 0;
        return {
          restaurantId: r, tableId: crypto.randomUUID(), payLater: true, note: MARK,
          couponCode: f.cardCouponCode,
          items: [{ itemId: dish.id, name: dish.name, price: Number(dish.price),
                    qty: 5, emoji: "🍽️", mods: {} }],
        };
      },
      expect: [404], expectError: /mesa no encontrada|table not found/i,
      effect: async f => {
        const { data } = await f.admin
          .from("coupons").select("uses_count").eq("id", f.cardCouponId).maybeSingle();
        return data?.uses_count === f.couponUsesBefore
          ? true
          : `the coupon went from ${f.couponUsesBefore} uses to ${data?.uses_count} on an order refused for its table`;
      } },
    // And one that cannot pass by being refused at the door.
    //
    // The case above accepts 200 OR 409, because with no Stripe account the
    // healthy answer really is 409 — which means it has never once exercised
    // the route's own code. Paying at the counter walks the same path and
    // needs no Stripe, so this is the first case that fails if verifying,
    // pricing or writing the order breaks.
    { name: "POST /api/checkout (pay at the counter)", as: "diner", method: "POST",
      path: "/api/checkout",
      body: { restaurantId: r, tableId: null, payLater: true, note: MARK,
        items: [{ itemId: dish.id, name: dish.name, price: Number(dish.price), qty: 3,
          emoji: "🍽️", mods: {} }] },
      expect: [200] },
    // Stripe Checkout takes 100 line items and this route makes one per line
    // plus the service charge and the tip, so the cart stops at 98.
    { name: "POST /api/checkout (more lines than Stripe would take)", as: "diner",
      method: "POST", path: "/api/checkout",
      body: { restaurantId: r, tableId: null, payLater: true, note: MARK,
        items: Array.from({ length: 99 }, () => ({ itemId: dish.id, name: dish.name,
          price: Number(dish.price), qty: 1, emoji: "🍽️", mods: {} })) },
      expect: [400] },
    { name: "POST /api/receipt", as: "diner", method: "POST", path: "/api/receipt",
      body: { orderId: paidOrder, email: "nobody@tabletap.dev" }, expect: [200, 400, 409, 503] },
  ];
}

export function checkoutPlanCases(fx) {
  const { restaurant, dish } = fx;
  const r = restaurant.id;
  return [
    // ── A tier without the feature: saved discounts stop ─────────────────
    // Promotions and coupons made on a tier that had them stay saved after a
    // move down, and used to go on discounting every sale. Each refusal has a
    // control on the demo's own tier first, so it cannot pass merely because
    // the request was malformed.
    { name: "POST /api/coupons/validate (a coupon the tier carries)", as: "diner", method: "POST",
      path: "/api/coupons/validate", body: async f => ({ restaurantId: r, code: f.cardCouponCode, subtotal: 1000 }),
      expect: [200], check: d => d.valid === true || `answered ${JSON.stringify(d).slice(0, 80)}` },
    { name: "POST /api/coupons/validate (a coupon on a tier without coupons)", as: "diner", method: "POST",
      path: "/api/coupons/validate", arrange: f => f.onCarta(),
      body: async f => ({ restaurantId: r, code: f.cardCouponCode, subtotal: 1000 }),
      expect: [200], check: d => (d.valid === false && d.reason === "notFound") || `answered ${JSON.stringify(d).slice(0, 80)}` },
    { name: "POST /api/checkout (a coupon on a tier without coupons)", as: "diner", method: "POST",
      path: "/api/checkout",
      arrange: async f => {
        const putReaderBack = await f.withCardReader();
        const putPlanBack = await f.onCarta();
        return async () => { await putPlanBack(); await putReaderBack(); };
      },
      body: async f => ({ restaurantId: r, tableId: null, note: MARK, couponCode: f.cardCouponCode,
        items: [{ itemId: dish.id, name: dish.name, price: Number(dish.price), qty: 5, emoji: "🍽️", mods: {} }] }),
      expect: [409], check: d => d.couponReason === "notFound" || `answered ${JSON.stringify(d).slice(0, 80)}` },
    // The control goes as far as Stripe, which refuses the fake account: the
    // combo passed every check before it.
    { name: "POST /api/checkout (a combo the tier carries)", as: "diner", method: "POST",
      path: "/api/checkout", arrange: f => f.withCardReader(),
      body: async f => ({ restaurantId: r, tableId: null, note: MARK, items: [f.combo] }),
      expect: [500], expectError: /pago falló|payment failed/i },
    { name: "POST /api/checkout (a combo on a tier without promotions)", as: "diner", method: "POST",
      path: "/api/checkout",
      arrange: async f => {
        const putReaderBack = await f.withCardReader();
        const putPlanBack = await f.onCarta();
        return async () => { await putPlanBack(); await putReaderBack(); };
      },
      body: async f => ({ restaurantId: r, tableId: null, note: MARK, items: [f.combo] }),
      expect: [400], expectError: /ya no está disponible|no longer available/i },
  ];
}

export function billPayCases(fx) {
  const { restaurant, table } = fx;
  const r = restaurant.id;
  return [
    // This case sent no orderIds, so it was refused at the body check and never
    // reached a line of the route — while `expect: [200, 400, 409]` accepted
    // that refusal, the no-card-reader one, and a success, all as a pass. It is
    // the route from the Mesa 10 bill: twelve people, "Error de red", and the
    // diner pressing pay again.
    { name: "POST /api/bill/pay (nothing to settle)", as: "diner", method: "POST",
      path: "/api/bill/pay", body: { restaurantId: r, tableId: table.id },
      expect: [400], expectError: /inválida|invalid/i },
    { name: "POST /api/bill/pay (no card reader)", as: "diner", method: "POST",
      path: "/api/bill/pay",
      body: async f => ({ restaurantId: r, tableId: f.billTableId, orderIds: [f.billOrder] }),
      expect: [409], expectError: /tarjeta|card payments/i },
    // The whole route, as far as Stripe. A fake account answers 502, and that
    // is the assertion: everything before it ran — the waiter and split
    // guards, the orders query scoped by restaurant AND table, the coupon
    // rules, the order-count cap and the metadata packing that #333 changed.
    { name: "POST /api/bill/pay (reaches Stripe with a real bill)", as: "diner",
      method: "POST", path: "/api/bill/pay", arrange: f => f.withCardReader(),
      body: async f => ({ restaurantId: r, tableId: f.billTableId, orderIds: [f.billOrder] }),
      expect: [502], expectError: /cobro|checkout|pago/i },
    { name: "POST /api/bill/pay (more orders than one bill can name)", as: "diner",
      method: "POST", path: "/api/bill/pay", arrange: f => f.withCardReader(),
      body: async f => ({
        restaurantId: r, tableId: f.billTableId,
        orderIds: Array.from({ length: 201 }, () => f.billOrder),
      }),
      expect: [400], expectError: /inválida|invalid/i },
    { name: "POST /api/bill/pay (another restaurant's table)", as: "diner",
      method: "POST", path: "/api/bill/pay", arrange: f => f.withCardReader(),
      body: async f => ({
        restaurantId: r, tableId: "00000000-0000-0000-0000-000000000000",
        orderIds: [f.billOrder],
      }),
      // Scoped by restaurant, table AND admission: a foreign table is refused
      // before either its food or its payment readiness can be read.
      expect: [403], expectError: /teléfono|phone/i },
  ];
}
