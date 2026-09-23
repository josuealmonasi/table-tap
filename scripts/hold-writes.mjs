// ============================================================================
// A sweep that clicks everything must change nothing.
//
// `pnpm dialogs` clicks every visible button on every screen as every role, and
// most buttons do not open a dialog — they act. One run sent 72 writes: it
// completed all thirteen live orders on the demo board, moved menus and
// categories up and down 24 times, paused and resumed promotions, duplicated
// four dishes that were never deleted, saved the settings, closed service
// requests, approved a write-off and turned down a discount. Every later
// `pnpm layout` then found no order on the board, printed "did not open (no
// data)" for the order dialog and moved on, so a gate had quietly switched
// another gate's check off.
//
// Two things stop it. Every write the page sends to the app or to the database
// is answered here, in the browser, with a harmless success, and never reaches
// the server. And the data the clicks could touch is fingerprinted before and
// after the sweep, so a write that finds another way out fails the run instead
// of changing the seed.
// ============================================================================

const READS = new Set(["GET", "HEAD", "OPTIONS"]);
// Our API, the database, and file storage. Sign-in (`/auth/v1/`) is left
// alone: refreshing a session is not a change to anything this measures.
const WRITABLE = /^\/(api|rest\/v1|storage\/v1)\//;

/**
 * Answers every write from this context in the browser, and lists what it held
 * back in `held`, so a run can say how many buttons acted instead of opening.
 */
export async function holdWrites(ctx, held) {
  await ctx.route(
    url => WRITABLE.test(url.pathname),
    route => {
      const req = route.request();
      if (READS.has(req.method())) return route.continue();
      const { pathname } = new URL(req.url());
      held.push(`${req.method()} ${pathname}`);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: pathname.startsWith("/api/") ? '{"ok":true}' : "[]",
      });
    },
  );
}

/**
 * Everything a click on a staff screen could change, in one comparable string.
 * Rows by id, so a reorder, a status change or one extra row all show.
 */
export async function fingerprint(admin, restaurantName) {
  const { data: r, error } = await admin
    .from("restaurants").select("*").eq("name", restaurantName).single();
  if (error || !r) throw new Error(`cannot fingerprint ${restaurantName}: ${error?.message ?? "not found"}`);
  const { updated_at: _changes, ...settings } = r;

  const rows = async (table, columns) => {
    const { data, error: e } = await admin
      .from(table).select(columns).eq("restaurant_id", r.id).order("id");
    if (e) throw new Error(`cannot fingerprint ${table}: ${e.message}`);
    return data;
  };
  return JSON.stringify({
    settings,
    orders: await rows("orders", "id, status, paid, written_off, total, discount"),
    menus: await rows("menus", "id, sort_order, active"),
    categories: await rows("categories", "id, sort_order"),
    items: await rows("menu_items", "id, available"),
    promotions: await rows("promotions", "id, active"),
    coupons: await rows("coupons", "id, active"),
    staff: await rows("staff", "id, role"),
    requests: await rows("service_requests", "id, status"),
    writeOffs: await rows("write_off_requests", "id, status"),
    discounts: await rows("discount_requests", "id, status"),
  });
}

/** Which parts of two fingerprints differ, by name. */
export function changedParts(before, after) {
  const a = JSON.parse(before);
  const b = JSON.parse(after);
  return Object.keys(a).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}
