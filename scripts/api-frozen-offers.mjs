import { MARK } from "./api-fixtures.mjs";
import { sharedRunFixtures } from "./run-fixtures.mjs";

/** Refusals share an unchanged offer; each case restores the freeze on failure. */
async function frozenOffer(f, table, active = true, readOnly = false) {
  const restaurantId = f.restaurant.id;
  const { data: before, error: readError } = await f.admin.from("restaurants")
    .select("plan_status").eq("id", restaurantId).single();
  if (readError) throw readError;
  let offer;
  const restore = async () => {
    const { error } = await f.admin.from("restaurants").update(before).eq("id", restaurantId);
    if (error) throw error;
    if (offer) await offer.cleanup();
  };
  try {
    offer = readOnly ? await sharedRunFixtures(f).acquire(`frozen-${table}-${active}`, () => plantOffer(f, table, active))
      : await plantOffer(f, table, active);
    f.frozenOffer = { table, before: offer.data };
    const { error: freezeError } = await f.admin.from("restaurants")
      .update({ plan_status: "locked" }).eq("id", restaurantId);
    if (freezeError) throw freezeError;
    return restore;
  } catch (error) {
    await restore();
    throw error;
  }
}

async function plantOffer(f, table, active) {
  const values = table === "promotions"
    ? { restaurant_id: f.restaurant.id, kind: "bogo", name: `${MARK} frozen`, buy_qty: 2, pay_qty: 1, active }
    : { restaurant_id: f.restaurant.id, code: `S14-${crypto.randomUUID()}`, kind: "percent", value: 10, active };
  const { data, error } = await f.admin.from(table).insert(values).select("*").single();
  if (error) throw error;
  const cleanup = async () => {
    const { error: removeError } = await f.admin.from(table).delete().eq("id", data.id);
    if (removeError) throw removeError;
  };
  try {
    if (table === "promotions") {
      const { error: linkError } = await f.admin.from("promotion_items")
        .insert({ promotion_id: data.id, item_id: f.dish.id, qty: 1 });
      if (linkError) throw linkError;
    }
    return { data, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

async function unchangedExceptActive(f, off = false) {
  const { table, before } = f.frozenOffer;
  const { data, error } = await f.admin.from(table).select("*").eq("id", before.id).maybeSingle();
  if (error) throw error;
  const expected = off ? { ...before, active: false } : before;
  return JSON.stringify(data) === JSON.stringify(expected) || "a frozen offer changed its terms or disappeared";
}

export function frozenOfferCases() {
  return ["promotions", "coupons"].flatMap(table => [
    { name: `PATCH /api/${table} (frozen: switching off is allowed)`, as: "manager", method: "PATCH",
      path: `/api/${table}`, arrange: f => frozenOffer(f, table),
      body: f => ({ id: f.frozenOffer.before.id, active: false }), expect: [200],
      effect: f => unchangedExceptActive(f, true) },
    { name: `PATCH /api/${table} (frozen: an off flag cannot hide an edit)`, as: "manager", method: "PATCH",
      path: `/api/${table}`, arrange: f => frozenOffer(f, table, true, true),
      body: f => ({ id: f.frozenOffer.before.id, active: false, name: "Changed", kind: "percent", value: 20 }),
      expect: [402], effect: f => unchangedExceptActive(f) },
    { name: `PATCH /api/${table} (frozen: resuming is refused)`, as: "manager", method: "PATCH",
      path: `/api/${table}`, arrange: f => frozenOffer(f, table, false, true),
      body: f => ({ id: f.frozenOffer.before.id, active: true }), expect: [402],
      effect: f => unchangedExceptActive(f) },
    { name: `DELETE /api/${table} (frozen: deleting is refused)`, as: "manager", method: "DELETE",
      path: `/api/${table}`, arrange: f => frozenOffer(f, table, true, true),
      body: f => ({ id: f.frozenOffer.before.id }), expect: [402],
      effect: f => unchangedExceptActive(f) },
  ]);
}
