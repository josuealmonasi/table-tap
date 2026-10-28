import { randomUUID } from "node:crypto";

const checked = async query => {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
};
/** A private sitting per case. Cleanup never borrows another case's orders or money. */
export async function splitSlotFixture(admin, restaurantId, { currency = "MXN", totalCents = 11000, shares = 2, start = true } = {}) {
  const tableId = randomUUID(), sessionId = randomUUID(), orderId = randomUUID(), ref = randomUUID();
  let splitId;
  const attempts = [];
  const scope = { restaurantId, tableId, sessionId };
  async function cleanup() {
    // Slots restrict deletion of their receipts and attempts. Remove that exact
    // fixture's split first; its immutable checkout links cascade with it.
    await checked(admin.from("bill_splits").delete().eq("session_id", sessionId));
    if (attempts.length) await checked(admin.from("diner_checkouts").delete().in("id", attempts));
    await checked(admin.from("payments").delete().eq("session_id", sessionId));
    await checked(admin.from("user_logs").delete().eq("restaurant_id", restaurantId).eq("entity", "bill")
      .in("action", ["collected", "paid"]).like("detail", `table=split-${ref.slice(0, 8)} %`));
    await checked(admin.from("orders").delete().eq("id", orderId));
    await checked(admin.from("table_sessions").delete().eq("id", sessionId));
    await checked(admin.from("restaurant_tables").delete().eq("id", tableId));
  }
  const rpc = async (name, args) => checked(admin.rpc(name, args));
  const startBody = { ...scope, shares, expectedCents: totalCents, currency, ref };
  async function begin() {
    const result = await rpc("start_bill_split_v2", { p_restaurant: restaurantId, p_table: tableId, p_session: sessionId,
      p_member: null, p_shares: shares, p_expected_cents: totalCents, p_currency: currency, p_ref: ref, p_flat_fee_cents: 300 });
    if (!["started", "repeat"].includes(result.outcome)) throw new Error(`start fixture: ${result.outcome}`);
    splitId = result.split;
    return result;
  }
  function body(slots = [0]) {
    const expectedCents = slots.reduce((sum, no) => sum + Math.floor(totalCents / shares) + (no === 0 ? totalCents % shares : 0), 0);
    return { ...scope, splitId, revision: 1, slots, expectedCents, currency, tipCents: 0, method: "cash", ref: randomUUID() };
  }
  async function hold(slots = [0], member = null) {
    const b = body(slots), id = randomUUID();
    const metadata = { restaurant_id: restaurantId, split_id: splitId, split_model: "2", split_revision: "1",
      split_member: member ?? "", split_slots: JSON.stringify(slots), split_amount: String(b.expectedCents / 100), settle_tip: "0" };
    attempts.push(id);
    await rpc("diner_checkout_open", { p_record: { id, restaurant_id: restaurantId, stripe_account_id: "acct_split_fixture",
      currency, livemode: false, amount_cents: b.expectedCents, order_ids: [orderId], payable_order_ids: [],
      scope_key: `split-fixture:${id}`, idempotency_key: `diner:${id}`, metadata, stripe_params: { mode: "payment", metadata },
      entitlements: {}, order_discounts: {}, food_principal: totalCents / 100 } });
    const args = { p_restaurant: restaurantId, p_split: splitId, p_revision: 1, p_member: member, p_slots: slots, p_checkout: id };
    const result = await rpc("reserve_split_slots_v1", args);
    return { id, args, result };
  }
  try {
    await checked(admin.from("restaurant_tables").insert({ id: tableId, restaurant_id: restaurantId, label: `split-${ref.slice(0, 8)}` }));
    await checked(admin.from("table_sessions").insert({ id: sessionId, restaurant_id: restaurantId, table_id: tableId, opened_by: "split-fixture" }));
    await checked(admin.from("orders").insert({ id: orderId, restaurant_id: restaurantId, table_id: tableId, session_id: sessionId,
      table_label: `split-${ref.slice(0, 8)}`, items: [], subtotal: totalCents / 100, total: totalCents / 100,
      tip: 0, service_fee: 0, tax_pct: 0, discount: 0, status: "received", paid: false, currency, note: "split-slot-fixture" }));
    if (start) await begin();
    return { scope, startBody, body, begin, hold, rpc, cleanup, orderId, get splitId() { return splitId; },
      slots: () => checked(admin.from("bill_split_slots").select("*").eq("split_id", splitId).order("share_no")),
      receipts: () => checked(admin.from("payments").select("*").eq("session_id", sessionId)) };
  } catch (error) { await cleanup(); throw error; }
}
