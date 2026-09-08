// ============================================================================
// Which screens `pnpm layout` checks, and as whom.
//
// Split from the runner because this is the list and that is the work: when a
// screen or a role is added, you touch this file and nothing else.
// ============================================================================

/** The five demo team logins, with what each one actually reaches. */
export const CREW = [
  {
    role: "owner",
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
    role: "manager",
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
  { role: "waiter", email: "demo-waiter@tabletap.dev", pages: ["/dashboard/orders", "/dashboard/bills", "/dashboard/profile"] },
  { role: "cashier", email: "demo-cashier@tabletap.dev", pages: ["/dashboard/orders", "/dashboard/bills", "/dashboard/profile"] },
  { role: "kitchen", email: "demo-kitchen@tabletap.dev", pages: ["/dashboard/orders", "/dashboard/profile"] },
  // The platform admin runs the whole business from one screen and was in no
  // check at all: at 390px its five columns gave the name 31px, so every
  // restaurant came out one letter per line and the headers overlapped.
  // Its password is its own, not the demo one.
  {
    role: "admin",
    email: "admin@tabletap.dev",
    passwordEnv: "PLATFORM_ADMIN_PASSWORD",
    pages: ["/dashboard/admin"],
  },
];

/**
 * The front door: every page a person meets before they have an account.
 *
 * Checked signed out, because that is the only way anyone ever sees them, and
 * because nothing else in this repo looked at them — landing, sign-up, sign-in
 * and password recovery had never been measured at any width.
 */
export const PUBLIC = [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/terminos",
  "/privacidad",
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
    { name: "order detail", click: ".tt-order-card" },
  ],
  "/dashboard/bills": [
    { name: "settle", text: "Cobrar" },
    { name: "promotion on the bill", click: ".tt-bill-open-main" },
  ],
  "/dashboard/tables": [
    { name: "add table", text: "Agregar mesa" },
  ],
  "/dashboard/promotions": [
    { name: "new combo", text: "Nuevo combo" },
  ],
  "/dashboard/main-menu": [
    { name: "new product", text: "Agregar producto" },
    { name: "new add-on", text: "Agregar extra" },
    { name: "new icon group", text: "Agregar grupo" },
    { name: "new dietary tag", text: "Agregar etiqueta" },
  ],
  "/dashboard/staff": [
    // The button says what it does — "Enviar invitación" — not "Agregar".
    { name: "invite someone", text: "Enviar invitación" },
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
  { name: "menu", expect: { es: "Llamar al mesero", en: "Call waiter" }, steps: [] },
  {
    name: "dish detail",
    expect: { es: "Agregar al carrito", en: "Add to cart" },
    steps: [{ click: { es: "[aria-label^='Abrir ']", en: "[aria-label^='Open ']" } }],
  },
  {
    name: "cart",
    expect: { es: "Total", en: "Total" },
    steps: [{ addToCart: true }, { click: ".tt-fab" }, { bottom: true }],
  },
  {
    name: "coupon",
    expect: { es: "Aplicar", en: "Apply" },
    steps: [{ addToCart: true }, { click: ".tt-fab" }, { text: { es: "cupón", en: "coupon" } }],
  },
  // The order tracker, which nothing measured until it was found scrolling a
  // 180px QR code to reach the way out. `at` starts the flow somewhere other
  // than the table, because this screen is reached by its own URL.
  {
    name: "order tracker",
    at: "/order/:orderId",
    expect: { es: "Tus platillos", en: "Your items" },
    steps: [],
  },
  {
    name: "custom tip",
    expect: { es: "Monto de propina", en: "Tip amount" },
    steps: [{ addToCart: true }, { click: ".tt-fab" }, { text: { es: "Otro", en: "Other" } }],
  },
];
