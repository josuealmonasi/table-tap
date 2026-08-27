// ============================================================================
// Which screens `pnpm layout` checks, and as whom.
//
// Split from the runner because this is the list and that is the work: when a
// screen or a role is added, you touch this file and nothing else.
// ============================================================================

/** The five demo team logins, with what each one actually reaches. */
export const CREW = [
  {
    role: "dueño",
    email: "demo@tabletap.dev",
    pages: [
      "/dashboard",
      "/dashboard/main-menu",
      "/dashboard/orders",
      "/dashboard/bills",
      "/dashboard/tables",
      "/dashboard/analytics",
      "/dashboard/promotions",
      "/dashboard/settings",
      "/dashboard/staff",
      "/dashboard/plan",
      "/dashboard/profile",
    ],
  },
  {
    role: "gerente",
    email: "demo-manager@tabletap.dev",
    // No staff or plan: they bounce, and a page you bounce off is another page,
    // already checked with its owner.
    pages: [
      "/dashboard",
      "/dashboard/main-menu",
      "/dashboard/orders",
      "/dashboard/bills",
      "/dashboard/tables",
      "/dashboard/analytics",
      "/dashboard/promotions",
      "/dashboard/settings",
      "/dashboard/profile",
    ],
  },
  { role: "mesero", email: "demo-waiter@tabletap.dev", pages: ["/dashboard/orders", "/dashboard/bills", "/dashboard/profile"] },
  { role: "cajero", email: "demo-cashier@tabletap.dev", pages: ["/dashboard/orders", "/dashboard/bills", "/dashboard/profile"] },
  { role: "cocina", email: "demo-kitchen@tabletap.dev", pages: ["/dashboard/orders", "/dashboard/profile"] },
];

/**
 * Dialogs, which is where the unseen lives.
 *
 * A card overlapping on a page gets noticed; inside a modal that only appears
 * when something is clicked, nobody sees it until a waiter finds it mid-
 * service. Each one opens its own and is measured as another screen.
 *
 * Best effort: if the trigger is not there — because that account has no data
 * today — it is skipped rather than failed. A test that demands specific data
 * is a test that falls over on its own.
 */
export const DIALOGS = {
  "/dashboard/orders": [
    { name: "detalle del pedido", click: ".tt-order-card" },
  ],
  "/dashboard/bills": [
    { name: "cobrar", text: "Cobrar" },
    { name: "promoción en la cuenta", click: ".tt-bill-open-main" },
  ],
  "/dashboard/tables": [
    { name: "agregar mesa", text: "Agregar mesa" },
  ],
  "/dashboard/promotions": [
    { name: "nuevo combo", text: "Nuevo combo" },
  ],
  "/dashboard/main-menu": [
    { name: "nuevo producto", text: "Agregar producto" },
    { name: "nuevo extra", text: "Agregar extra" },
    { name: "nuevo grupo de iconos", text: "Agregar grupo" },
    { name: "nueva etiqueta de dieta", text: "Agregar etiqueta" },
  ],
  "/dashboard/staff": [
    // The button says what it does — "Enviar invitación" — not "Agregar".
    { name: "invitar a alguien", text: "Enviar invitación" },
  ],
};

/**
 * What a diner does, step by step.
 *
 * The cart was already checked; the rest was not. The dish detail is the most
 * crowded screen in the app — photo, options, extras, note, price and counter
 * — and the coupon and the tip open modals on top of the cart.
 */
export const DINER = [
  // `expect` is what proves we arrived: without it, a step that does not fire
  // leaves the previous screen up and the menu gets measured as something else.
  // It happened — a dish row is a div with role="button", not a <button>, so the
  // selector found nothing and nobody noticed.
  { name: "menú", expect: { es: "Llamar al mesero", en: "Call waiter" }, steps: [] },
  {
    name: "ficha del platillo",
    expect: { es: "Agregar al carrito", en: "Add to cart" },
    steps: [{ click: { es: "[aria-label^='Abrir ']", en: "[aria-label^='Open ']" } }],
  },
  {
    name: "carrito",
    expect: { es: "Total", en: "Total" },
    steps: [{ addToCart: true }, { click: ".tt-fab" }, { bottom: true }],
  },
  {
    name: "cupón",
    expect: { es: "Aplicar", en: "Apply" },
    steps: [{ addToCart: true }, { click: ".tt-fab" }, { text: { es: "cupón", en: "coupon" } }],
  },
  {
    name: "propina personalizada",
    expect: { es: "Monto de propina", en: "Tip amount" },
    steps: [{ addToCart: true }, { click: ".tt-fab" }, { text: { es: "Otro", en: "Other" } }],
  },
];
