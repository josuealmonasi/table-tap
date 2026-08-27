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
 * `says` is what the screen MUST contain; `offers` is a control it must NOT.
 * Each case changes one thing — the runner puts everything back afterwards.
 */
export const STATES = [
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
    name: "free plan · promotions",
    as: "owner",
    path: "/dashboard/promotions",
    apply: (admin, c) => admin.from("restaurants").update({ plan: "carta", plan_status: "active" }).eq("id", c.restaurantId),
    says: /viene[n]? con|comes with/i,
    offers: /nuevo combo|new combo/i,
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
    name: "counter order ready",
    as: "tracker",
    // Placed from the general QR, so nobody is carrying it anywhere. The
    // tracker used to tell them their food was coming "to Table  !", with the
    // number simply missing.
    says: /recoger|collect/i,
    offers: /a la Mesa\s*!|to Table\s*!/i,
  },
];
