// ============================================================================
// Qué pantallas revisa `pnpm layout`, y con quién.
//
// Separado del runner porque esto es la lista y aquello es el trabajo: cuando
// se agrega una pantalla o un rol, se toca este archivo y nada más.
// ============================================================================

/** Los cinco accesos del equipo demo, con lo que cada uno alcanza de verdad. */
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
    // Sin personal ni plan: rebotan, y una página a la que rebotas es otra
    // página, que ya se revisa con su dueño.
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
 * Diálogos, que es donde vive lo que no se ve.
 *
 * Una tarjeta encimada en una página se nota; dentro de un modal que sólo
 * aparece al pulsar algo, no la ve nadie hasta que un mesero la encuentra a
 * media comida. Cada uno abre lo suyo y se mide como una pantalla más.
 *
 * Son de mejor esfuerzo: si el disparador no está —porque esa cuenta no tiene
 * datos hoy— se salta en vez de fallar. Una prueba que exige datos concretos
 * es una prueba que se cae sola.
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
  ],
  "/dashboard/staff": [
    // El botón dice lo que hace —"Enviar invitación"— no "Agregar".
    { name: "invitar a alguien", text: "Enviar invitación" },
  ],
};

/**
 * Lo que hace un comensal, paso a paso.
 *
 * El carrito ya se revisaba; lo demás no. La ficha del platillo es la pantalla
 * con más cosas apretadas de toda la app —foto, opciones, extras, nota, precio
 * y contador— y el cupón y la propina abren modales encima del carrito.
 */
export const DINER = [
  // `expect` es lo que prueba que llegamos: sin él, un paso que no dispara
  // deja la pantalla anterior puesta y se mide el menú creyendo que es otra
  // cosa. Pasó — la fila de un platillo es un div con role="button", no un
  // <button>, así que el selector no encontraba nada y nadie se enteraba.
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
