import { MARK } from "./api-fixtures.mjs";

/** Each case owns its offer and restores the freeze even when the request fails. */
async function frozenOffer(f, table, active = true) {
  const restaurantId = f.restaurant.id;
  const { data: before, error: readError } = await f.admin.from("restaurants")
    .select("plan_status").eq("id", restaurantId).single();
  if (readError) throw readError;
  const values = table === "promotions"
    ? { restaurant_id: restaurantId, kind: "bogo", name: `${MARK} frozen`, buy_qty: 2, pay_qty: 1, active }
    : { restaurant_id: restaurantId, code: `S14-${Date.now()}`, kind: "percent", value: 10, active };
  let id;
  const restore = async () => {
    const { error } = await f.admin.from("restaurants").update(before).eq("id", restaurantId);
    if (error) throw error;
    if (id) {
      const { error: removeError } = await f.admin.from(table).delete().eq("id", id);
      if (removeError) throw removeError;
    }
  };
  try {
    const { data, error } = await f.admin.from(table).insert(values).select("*").single();
    if (error) throw error;
    id = data.id;
    f.frozenOffer = { table, before: data };
    if (table === "promotions") {
      const { error: linkError } = await f.admin.from("promotion_items")
        .insert({ promotion_id: id, item_id: f.dish.id, qty: 1 });
      if (linkError) throw linkError;
    }
    const { error: freezeError } = await f.admin.from("restaurants")
      .update({ plan_status: "locked" }).eq("id", restaurantId);
    if (freezeError) throw freezeError;
    return restore;
  } catch (error) {
    await restore();
    throw error;
  }
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
      path: `/api/${table}`, arrange: f => frozenOffer(f, table),
      body: f => ({ id: f.frozenOffer.before.id, active: false, name: "Changed", kind: "percent", value: 20 }),
      expect: [402], effect: f => unchangedExceptActive(f) },
    { name: `PATCH /api/${table} (frozen: resuming is refused)`, as: "manager", method: "PATCH",
      path: `/api/${table}`, arrange: f => frozenOffer(f, table, false),
      body: f => ({ id: f.frozenOffer.before.id, active: true }), expect: [402],
      effect: f => unchangedExceptActive(f) },
    { name: `DELETE /api/${table} (frozen: deleting is refused)`, as: "manager", method: "DELETE",
      path: `/api/${table}`, arrange: f => frozenOffer(f, table),
      body: f => ({ id: f.frozenOffer.before.id }), expect: [402],
      effect: f => unchangedExceptActive(f) },
  ]);
}
