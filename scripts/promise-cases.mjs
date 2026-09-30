// ============================================================================
// What `pnpm promises` looks at, and in which state.
//
// Split from the runner for the same reason layout-paths is: this is the list
// and that is the work. Adding a state means touching this file only.
// ============================================================================

/**
 * What is measured inside each section, in the page.
 *
 * Controls are things you interact with: if they are there, the section
 * invites you to do something. Rows are any data. A declared empty state is
 * the text that says "nothing here yet" — the app already uses it in several
 * places, and it is what separates an honest answer from silence.
 */
export const AUDIT = `(() => {
  const ROWS = ".tt-log-row,.tt-prod,.tt-order-card,.tt-bill-row,.tt-table-row," +
    ".tt-coupon-row,.tt-hist-row,.tt-rate-row,.tt-menu-row,.tt-doc-row,.tt-card," +
    "tbody tr,li";
  const out = [];

  // Only controls that presuppose data count: search, sort, paginate, filter.
  // A form for CREATING something — two password boxes, a new dish — promises
  // nothing that is not there, and flagging it would be noise.
  const isOverData = section => {
    if (section.querySelector("button[class*='sort'],[class*='pager'],[class*='paginat']")) return true;
    for (const input of section.querySelectorAll("input")) {
      const hint = ((input.placeholder || "") + " " + (input.getAttribute("aria-label") || "")).toLowerCase();
      if (input.type === "search" || /busca|buscar|search|filtr/.test(hint)) return true;
    }
    return false;
  };

  for (const section of document.querySelectorAll(".tt-section")) {
    const heading = section.querySelector("h2,h3,h4");
    if (!heading) continue;
    const title = heading.textContent.trim().slice(0, 40);

    // A skeleton is still loading, not empty.
    if (section.querySelector("[class*='keleton']")) continue;
    if (!isOverData(section)) continue;
    if (section.querySelectorAll(ROWS).length > 0) continue;

    // What is left once heading and controls are removed: if it says anything,
    // the section is explaining itself, which is an honest answer.
    const clone = section.cloneNode(true);
    for (const el of clone.querySelectorAll("h2,h3,h4,input,select,textarea,button,label,style,script")) el.remove();
    if (clone.textContent.replace(/\\s+/g, " ").trim().length >= 25) continue;

    out.push({ title });
  }
  return out;
})()`;

/**
 * States, which is where the promises break.
 *
 * Every gap found by hand lived in one: orders paused, no menu serving, no
 * Stripe connected, a tier without the feature. A screen that is fine with the
 * demo's full data can still be a blank page or a dead button once a switch
 * moves, and nothing swept those.
 *
 * `says` is what the screen MUST contain; `offers` is a control it must NOT;
 * `keeps` is one that must still be there, so a screen cannot pass by hiding
 * everything. `open` is a button to press first, for a promise made inside a
 * dialog. `refuse` answers a route with a 429, as a busy server does: from
 * the start, or `afterOpen` so that it is the next read that fails. Each case
 * changes one thing — the runner puts everything back afterwards.
 */
/**
 * What the server says when it refuses a request for being too many — the
 * Spanish of `apiErr.tooManyRequests`, which is what a refused screen shows.
 */
export const REFUSAL = {
  es: "Demasiadas solicitudes",
};

// "Lo de siempre": a phone that ordered the same dish twice is offered it
// back. The dish is picked by name inside the main menu — the demo has two
// dishes of some names, one per menu — and remembered here, so the case that
// sells it out puts the same one back.
let usualDishId = null;
async function usualStorage(admin, c) {
  const { data: menu } = await admin.from("menus").select("id")
    .eq("restaurant_id", c.restaurantId).eq("name", "Main Menu").single();
  const { data: dish } = await admin.from("menu_items").select("id")
    .eq("menu_id", menu.id).eq("is_addon", false).eq("available", true)
    .order("name").limit(1).single();
  usualDishId = dish.id;
  const usual = [{ itemId: dish.id, extras: [], mods: {}, qty: 1, count: 2, last: Date.now() }];
  return { [`tt-usual:${c.restaurantId}`]: JSON.stringify(usual) };
}
const USUAL_TAB = /^\s*(lo de siempre|your usual)\s*$/i;

// A combo of the audit's own, from the main menu, which serves at every hour.
// The seed's is built from the weekend brunch, so on a weekday it is off the
// menu for a reason that has nothing to do with the plan.
const AUDIT_COMBO = "Audit combo";
async function plantCombo(admin, c) {
  const { data: menu } = await admin.from("menus").select("id")
    .eq("restaurant_id", c.restaurantId).eq("name", "Main Menu").single();
  const { data: dish } = await admin.from("menu_items").select("id, price")
    .eq("menu_id", menu.id).eq("is_addon", false).eq("available", true)
    .order("name").limit(1).single();
  const { data: combo } = await admin.from("promotions")
    .insert({ restaurant_id: c.restaurantId, kind: "combo", name: AUDIT_COMBO, emoji: "🧪",
      combo_price: Number(dish.price), active: true, sort_order: -1 })
    .select("id").single();
  await admin.from("promotion_items").insert({ promotion_id: combo.id, item_id: dish.id, qty: 2 });
}
const uprootCombo = (admin, c) =>
  admin.from("promotions").delete().eq("restaurant_id", c.restaurantId).eq("name", AUDIT_COMBO);

export const STATES = [
  // The visit card's scanner, shown only where a stamp would be taken. The
  // first case is the control: with the program on the button is there, so
  // the two after it cannot pass merely because it never renders at all.
  {
    name: "visit card on · bills",
    as: "owner",
    path: "/dashboard/bills",
    says: /cuentas|bills/i,
    keeps: /sellar tarjeta|stamp a card/i,
  },
  // The diner's side: offered a card on a paid order only while the program
  // runs. The control first, for the same reason as the scanner's.
  {
    name: "visit card on · a paid order",
    as: "tracker",
    says: /junta visitas|collect visits/i,
    keeps: /crear mi tarjeta|get my card/i,
  },
  {
    // From the menu, any time: the diner does not have to pay first to find it.
    name: "visit card on · the menu",
    says: /tarjeta de visitas|visit card/i,
    keeps: /tarjeta de visitas|visit card/i,
  },
  {
    name: "visit card switched off · the menu",
    apply: (admin, c) => admin.from("loyalty_programs").update({ active: false }).eq("restaurant_id", c.restaurantId),
    says: /llamar al mesero|call waiter/i,
    offers: /tarjeta de visitas|visit card/i,
  },
  {
    // …and so does the menu, nearest reward first — in the sheet its chip
    // opens, since the chip itself only names the card. Opened here rather
    // than assumed: a chip that opened nothing would leave the ladder unsaid.
    name: "a reward ladder · the menu",
    open: /^\s*(tarjeta de visitas|visit card)\s*$/i,
    says: /(visitas|visits) = free coffee/i,
    keeps: /crear mi tarjeta|get my card/i,
  },
  {
    name: "your usual · the menu",
    storage: usualStorage,
    open: USUAL_TAB,
    says: /lo que más pides aquí|what you order most/i,
    keeps: /agregar lo de siempre|add my usual/i,
  },
  {
    // Sold out since: the tab is not offered at all, rather than offering a
    // usual the cart would refuse.
    name: "your usual, its dish sold out · the menu",
    storage: usualStorage,
    apply: admin => admin.from("menu_items").update({ available: false }).eq("id", usualDishId),
    undo: admin => admin.from("menu_items").update({ available: true }).eq("id", usualDishId),
    says: /llamar al mesero|call waiter/i,
    offers: USUAL_TAB,
  },
  {
    // The demo's program is a ladder: the offer names every reward, not only
    // the last, or a diner would never learn the coffee comes at four visits.
    name: "a reward ladder · a paid order",
    as: "tracker",
    says: /4 (visitas|visits) = free coffee/i,
    keeps: /crear mi tarjeta|get my card/i,
  },
  {
    name: "visit card switched off · a paid order",
    as: "tracker",
    apply: (admin, c) => admin.from("loyalty_programs").update({ active: false }).eq("restaurant_id", c.restaurantId),
    says: /listo|ready|recoger|collect/i,
    offers: /crear mi tarjeta|get my card/i,
  },
  {
    name: "visit card switched off · bills",
    as: "owner",
    path: "/dashboard/bills",
    apply: (admin, c) => admin.from("loyalty_programs").update({ active: false }).eq("restaurant_id", c.restaurantId),
    says: /cuentas|bills/i,
    offers: /sellar tarjeta|stamp a card/i,
    keeps: /^\s*(escanear|scan)\s*$/i,
  },
  {
    // Its own page, switched on: it says so, and the scanner is there.
    name: "visit card on · its page",
    as: "owner",
    path: "/dashboard/loyalty",
    says: /está activa|is on/i,
    keeps: /sellar tarjeta|stamp a card/i,
  },
  {
    // The ladder is edited here, a row per reward, up to four.
    name: "a reward ladder · its page",
    as: "owner",
    path: "/dashboard/loyalty",
    says: /hasta 4, cada una|up to 4, each/i,
    keeps: /añadir recompensa|add a reward/i,
  },
  {
    // Switched off, the page used to be a bare form: nothing said the card was
    // off, so no offer for diners and no stamp for the team looked broken. It
    // says so now, and offers no stamping the routes would refuse.
    name: "visit card switched off · its page",
    as: "owner",
    path: "/dashboard/loyalty",
    apply: (admin, c) => admin.from("loyalty_programs").update({ active: false }).eq("restaurant_id", c.restaurantId),
    says: /está apagada|switched off/i,
    offers: /sellar tarjeta|stamp a card|sellar visita|stamp a visit/i,
    keeps: /^\s*(escanear|scan)\s*$/i,
  },
  {
    // Its own page names the plan that carries it, and offers nothing to save
    // — but keeps a way to redeem what diners already earned, which the terms
    // promise survives a change of plan. Carta: every paid tier has the card
    // since Caja arrived with it.
    name: "a plan without the visit card · its page",
    as: "owner",
    path: "/dashboard/loyalty",
    apply: (admin, c) => admin.from("restaurants").update({ plan: "carta", plan_status: "active" }).eq("id", c.restaurantId),
    says: /sigue siendo suyo|still theirs/i,
    offers: /^\s*(guardar|save)\s*$/i,
    keeps: /^\s*(escanear|scan)\s*$/i,
  },
  {
    name: "a plan without the visit card · bills",
    as: "owner",
    path: "/dashboard/bills",
    apply: (admin, c) => admin.from("restaurants").update({ plan: "carta", plan_status: "active" }).eq("id", c.restaurantId),
    says: /cuentas|bills/i,
    offers: /sellar tarjeta|stamp a card/i,
    keeps: /^\s*(escanear|scan)\s*$/i,
  },
  {
    // Caja: the menu is to read, and the order is taken at the register. It
    // says so, and offers nothing a register-only plan does not have — no
    // waiter to call, and no table bill to pay from the phone.
    name: "Caja · the menu",
    as: "diner",
    apply: (admin, c) => admin.from("restaurants").update({ plan: "caja", plan_status: "active" }).eq("id", c.restaurantId),
    says: /pasa a la caja|go to the register/i,
    offers: /llamar al mesero|call waiter|ver mi cuenta|view my bill/i,
  },
  {
    // …and the register itself works, because it is the whole of the plan.
    name: "Caja · the till",
    as: "owner",
    path: "/dashboard/pos",
    apply: (admin, c) => admin.from("restaurants").update({ plan: "caja", plan_status: "active" }).eq("id", c.restaurantId),
    says: /toca un platillo para empezar|tap a dish to start/i,
  },
  {
    // A kitchen login kept through a move down to Caja has no board to open.
    // /dashboard sent it to the board and the board sent it back to
    // /dashboard: the browser bounced between them and the person saw an
    // empty frame. It has to land on a sentence that says why.
    name: "Caja · a kitchen login",
    as: "kitchen",
    path: "/dashboard",
    apply: (admin, c) => admin.from("restaurants").update({ plan: "caja", plan_status: "active" }).eq("id", c.restaurantId),
    says: /no tiene pantalla en caja|has no screen on caja/i,
  },
  {
    // A payment failed and Stripe is retrying. The terms promise the owner is
    // told; it said so only on the Plan page, which an owner may never open.
    name: "a payment being retried · the dashboard",
    as: "owner",
    path: "/dashboard",
    apply: (admin, c) => admin.from("restaurants").update({ plan_status: "past_due" }).eq("id", c.restaurantId),
    // The sentence and the link to fix it, in one: the link is an <a>, which
    // `keeps` (buttons only) cannot see.
    says: /no pudimos cobrar tu último pago[\s\S]*revisar el pago|couldn't collect your last payment[\s\S]*check the payment/i,
  },
  {
    name: "orders paused",
    as: "diner",
    apply: (admin, c) => admin.from("restaurants").update({ accepting_orders: false }).eq("id", c.restaurantId),
    says: /no estamos tomando pedidos|not taking orders/i,
  },
  {
    name: "no menu serving",
    as: "diner",
    apply: (admin, c) => admin.from("menus").update({ active: false }).eq("restaurant_id", c.restaurantId),
    says: /cerrados|closed/i,
  },
  {
    name: "subscription paused",
    as: "owner",
    path: "/dashboard/settings",
    apply: (admin, c) => admin.from("restaurants").update({ plan_status: "locked" }).eq("id", c.restaurantId),
    says: /solo de lectura|read-only/i,
  },
  {
    // The control for the case after it: on the demo's own tier a combo is on
    // the menu, and the sweep can see it.
    name: "the menu · a combo",
    as: "diner",
    apply: plantCombo,
    undo: uprootCombo,
    says: /audit combo/i,
    keeps: /audit combo/i,
  },
  {
    // Promotions saved on a tier that had them stayed on the menu after a move
    // to Carta — and discounted at checkout — while the owner was told they
    // come with Servicio, and the terms say a paid plan's features stop.
    name: "free plan · the menu",
    as: "diner",
    apply: async (admin, c) => {
      await plantCombo(admin, c);
      await admin.from("restaurants").update({ plan: "carta", plan_status: "active" }).eq("id", c.restaurantId);
    },
    undo: uprootCombo,
    says: /demo bistro/i,
    offers: /audit combo/i,
  },
  {
    name: "free plan · promotions",
    as: "owner",
    path: "/dashboard/promotions",
    apply: (admin, c) => admin.from("restaurants").update({ plan: "carta", plan_status: "active" }).eq("id", c.restaurantId),
    says: /viene[n]? con|comes with/i,
    offers: /nuevo combo|new combo/i,
    // The control for the case after it: the owner is offered the plans.
    keeps: /ver planes|see plans/i,
  },
  {
    // The same lock, seen by a manager. /dashboard/plan is the owner's alone,
    // so "Ver planes" sent a manager back to the dashboard with no word why.
    name: "free plan · promotions, as a manager",
    as: "manager",
    path: "/dashboard/promotions",
    apply: (admin, c) => admin.from("restaurants").update({ plan: "carta", plan_status: "active" }).eq("id", c.restaurantId),
    says: /solo el dueño puede cambiar el plan|only the owner can change the plan/i,
    offers: /ver planes|see plans/i,
  },
  {
    // The saved ones are still listed with their switches, so the owner is
    // told none of them reaches a diner while the tier lacks them.
    name: "free plan · saved promotions",
    as: "owner",
    path: "/dashboard/promotions",
    apply: (admin, c) => admin.from("restaurants").update({ plan: "carta", plan_status: "active" }).eq("id", c.restaurantId),
    says: /no aparecen en el menú ni se aplican|not on the menu and take nothing off/i,
  },
  {
    name: "free plan · tables",
    as: "owner",
    path: "/dashboard/tables",
    apply: (admin, c) => admin.from("restaurants").update({ plan: "carta", plan_status: "active" }).eq("id", c.restaurantId),
    says: /viene[n]? con|comes with/i,
    offers: /agregar mesa|add table/i,
  },
  {
    // Mesa 10, in production, on a bill twelve people had agreed to divide.
    // The screen offered "pago en línea"; /api/bill/pay answered 409 because
    // the restaurant has no Stripe account; the diner was shown "network
    // error — try again" and pressed it again.
    //
    // `as: "bill"` plants something owed on the table and opens the bill,
    // because that is where this promise is made. No other case had ever
    // opened a dialog, which is why the sweep walked past it for months.
    name: "no card reader · the bill",
    as: "bill",
    apply: (admin, c) =>
      admin.from("restaurants")
        .update({ stripe_account_id: null, stripe_charges_enabled: false })
        .eq("id", c.restaurantId),
    open: /ver mi cuenta|view my bill/i,
    says: /no cobra con tarjeta|can't take cards/i,
    // The card button, and dividing it — a share is charged through the same
    // route, so twelve agreed shares would have been twelve refusals.
    offers: /pago en l|pay online|dividir|split/i,
    // And the one that needs nothing but a floor has to still be there.
    keeps: /pagar en la mesa|pay at the table/i,
  },
  {
    // The other half of Mesa 10: one phone had ordered, and the bill offered to
    // divide it between up to twenty. The diner chose twelve, eleven of those
    // shares belonged to nobody, and until the proposal was called off the bill
    // could not be paid by anyone at all.
    //
    // Cards are switched ON for this one, so what is measured is the split and
    // not the refusal the case above checks.
    name: "a table of one · the bill",
    as: "bill",
    apply: (admin, c) =>
      admin.from("restaurants")
        .update({ stripe_account_id: "acct_promise_audit", stripe_charges_enabled: true })
        .eq("id", c.restaurantId),
    open: /ver mi cuenta|view my bill/i,
    says: /total/i,
    // No way in to dividing it, because there is nobody to divide it with.
    offers: /dividir|split/i,
    // And the bill itself is still perfectly payable.
    keeps: /pago en l|pay online|pagar en la mesa|pay at the table/i,
  },
  {
    // The table froze a split between two of them; this phone ordered and took
    // no share. Hiding the whole-bill button here was right — paying it charges
    // for food the shares already cover — but hiding the waiter with it left
    // them looking at a bill with nothing on the screen to press at all, not
    // even a way to ask for help. A dead end is not better than a wrong button.
    name: "a frozen split, no share · the bill",
    as: "bill",
    frozen: true,
    apply: (admin, c) =>
      admin.from("restaurants")
        .update({ stripe_account_id: "acct_promise_audit", stripe_charges_enabled: true })
        .eq("id", c.restaurantId),
    open: /ver mi cuenta|view my bill/i,
    says: /dividi|divided/i,
    // No second way to pay the same food.
    offers: /pago en l|pay online/i,
    // But somebody can always be called over.
    keeps: /pagar en la mesa|pay at the table/i,
  },
  {
    // The plan-gated money controls. `pnpm promises` had two free-plan states
    // and both were about screens the plan hides entirely; these are the
    // harder shape — a screen the plan KEEPS, carrying buttons it does not.
    // `/api/table-payment/part` refuses without waiter service and
    // `/api/bill/discount` without staff discounts, and the bills screen
    // offered both regardless. On `servicio` — a PAYING tier — the calculator
    // filled a discount picker from an endpoint that is not plan-gated and
    // then answered 409 to the code the waiter had just chosen out loud.
    name: "free plan · collecting a bill",
    as: "owner",
    path: "/dashboard/bills",
    apply: (admin, c) =>
      admin.from("restaurants").update({ plan: "carta", plan_status: "active" }).eq("id", c.restaurantId),
    open: /^\s*(Cobrar|Collect)\s*$/i,
    says: /cuenta|bill/i,
    // The calculator's door, which the route refuses on this plan.
    offers: /cobrar por partes|collect in parts/i,
    // Settling in full still works and must stay.
    keeps: /pagó en efectivo|paid cash/i,
  },
  {
    // A bill that could not be read is not a paid one. A refused poll used to
    // come back as `{ orders: [] }`, and an empty bill is a settled bill: it
    // hid the bill under a diner who owed it, and asked whether they wanted a
    // receipt for paying it. One 429 from a busy Wi-Fi was enough.
    name: "the bill cannot be read · the diner",
    as: "bill",
    apply: (admin, c) =>
      admin.from("restaurants")
        .update({ stripe_account_id: "acct_promise_audit", stripe_charges_enabled: true })
        .eq("id", c.restaurantId),
    open: /ver mi cuenta|view my bill/i,
    // The bill polls every ten seconds while it is open.
    refuse: { url: "**/api/bill?*", afterOpen: true, wait: 11_500 },
    says: /total/i,
    // Nothing that belongs to a bill already paid.
    offers: /enviar recibo|send receipt|crear mi tarjeta|create my card/i,
    keeps: /pagar en la mesa|pay at the table/i,
  },
  {
    // The waiter's side of the same thing: a read that failed said "Esta mesa
    // no debe nada", and the table could have walked out on a waiter who
    // believed it.
    name: "the bill cannot be read · the waiter",
    as: "owner",
    path: "/dashboard/bills",
    refuse: { url: "**/api/table-bill?*" },
    open: /^\s*(Cobrar|Collect)\s*$/i,
    says: /no se pudo cargar la cuenta|couldn't load this table's bill/i,
    // Nothing to collect against a number nobody has.
    offers: /pagó en efectivo|paid cash/i,
    keeps: /intentar de nuevo|try again/i,
  },
  {
    // A failed read of the promotions said "Aún no hay promociones. Crea una
    // abajo." — and a manager who believed it would set up again the deals
    // that already exist. Refused, the panel must say it could not load them
    // and offer to try again.
    name: "the promotions cannot be read · promotions",
    as: "owner",
    path: "/dashboard/promotions",
    refuse: { url: "**/rest/v1/promotions?*" },
    says: /no pudimos cargar las promociones|couldn't load the promotions/i,
    keeps: /intentar de nuevo|try again/i,
  },
  {
    // "Llamar al mesero" said "¡En camino!" for a minute whatever came back.
    // Refused the way a busy room's Wi-Fi refuses it, the button must come
    // back and the screen must say why — never that somebody is coming.
    name: "the waiter cannot be called · the menu",
    refuse: { url: "**/api/service-requests" },
    open: /llamar al mesero|call waiter/i,
    says: /demasiadas solicitudes|too many requests/i,
    offers: /en camino|on the way/i,
    keeps: /llamar al mesero|call waiter/i,
  },
  {
    // The board held a move the server refused as though the connection had
    // dropped: "saved, will be sent", the ticket moved on this screen only,
    // and refused again on every reconnect. Refused as a busy server refuses,
    // it must say why — which the offline path never did.
    name: "a move the server refuses · the board",
    as: "owner",
    path: "/dashboard/orders",
    refuse: { url: "**/api/orders" },
    open: /^\s*(Empezar a preparar|Start preparing)\s*$/i,
    says: /demasiadas solicitudes|too many requests/i,
    keeps: /^\s*(Empezar a preparar|Start preparing)\s*$/i,
  },
  {
    name: "counter order ready",
    as: "tracker",
    // Placed from the general QR, so nobody is carrying it anywhere. The
    // tracker used to tell them their food was coming "to Table  !", with the
    // number simply missing.
    says: /recoger|collect/i,
    offers: /a la Mesa\s*!|to Table\s*!/i,
  },
];
