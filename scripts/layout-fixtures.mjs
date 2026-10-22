async function read(query) {
  const { data, error } = await query;
  if (error) throw new Error(`could not read layout fixtures: ${error.message}`);
  return data;
}

export async function layoutFixtures(admin) {
  const r = await read(admin.from("restaurants").select("id").eq("name", "Demo Bistro").single());
  // A free table: one with an open bill opens the order tracker, not the menu,
  // and then there is no cart to check.
  const tables = await read(admin.from("restaurant_tables").select("id").eq("restaurant_id", r.id));
  const busy = await read(admin.from("orders").select("table_id").eq("restaurant_id", r.id).eq("paid", false));
  const taken = new Set((busy ?? []).map(o => o.table_id));
  const table = tables.find(t => !taken.has(t.id)) ?? tables[0];

  // Any order at all is enough to measure the tracker: the screen is the same
  // shape whether it is paid or still owing, apart from the payment QR.
  const tracked = await read(admin
    .from("orders")
    .select("id")
    .eq("restaurant_id", r.id)
    .neq("status", "pending_payment")
    .limit(1)
    .maybeSingle());
  const anyOrder = tracked?.id ?? null;
  if (!table) throw new Error("no demo table for the diner flows");

  // The rewards page with a card on it, as a diner's camera opens it. A code
  // cannot be known in advance, so it is read from the seed — one that has
  // spent a reward, so the history is on the page too. None in development
  // means the seed lost the feature, which is a fault; none in production just
  // means nobody has a card yet, and is said rather than counted.
  const spent = await read(admin.from("loyalty_redemptions").select("card_id").limit(1).maybeSingle());
  const card = spent
    ? await read(admin.from("loyalty_cards").select("code").eq("id", spent.card_id).maybeSingle()) : null;
  return { r, table, anyOrder, card };
}
