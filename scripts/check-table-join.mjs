/** Admission is judged on returned food and stored decisions, not just status codes. */
export async function checkTableJoin(s, who) {
  const { admin, send, first, second, third, approved, orderId, table, body } = s;
  const fail = message => { throw new Error(message); };
  const billPath = `/api/bill?restaurantId=${body.restaurantId}&tableId=${table.id}`;
  const decide = (phone, approve, cookie) => send("/api/table-membership", "PATCH", { ...body, memberId: phone.body.diner, approve }, cookie);
  if (second.body.status !== "pending" || third.body.status !== "pending") fail("A new phone was not pending");
  for (const cookie of ["", second.cookie, third.cookie, `tt-table-member=${approved.diner}`]) {
    const bill = await send(billPath, "GET", null, cookie);
    if (bill.status !== 403 || bill.body.orders) fail("An unapproved phone read the bill");
  }
  const deniedOrder = await send("/api/checkout", "POST", {
    ...body, payLater: true, diner: approved.diner,
    items: [{ itemId: s.dish?.id ?? crypto.randomUUID(), qty: 1, mods: {} }],
  }, second.cookie);
  if (deniedOrder.status !== 403 || !/teléfono|phone/i.test(deniedOrder.body.error)) fail("A pending phone could order or bypass admission");
  if ((await decide(second, true, who.kitchen)).status !== 403) fail("Kitchen approved a phone");
  if ((await decide(second, true, third.cookie)).status !== 403) fail("A pending phone approved another");
  if ((await decide(second, true, who.waiter)).status !== 200) fail("Waiter could not approve a phone");
  const bill = await send(billPath, "GET", null, second.cookie);
  if (bill.status !== 200 || !bill.body.orders.some(o => o.id === orderId)) fail("An approved phone could not read its bill");
  if ((await decide(third, false, first.cookie)).status !== 200) fail("An approved phone could not reject another");
  const fourth = await send("/api/table-membership", "POST", body);
  if ((await decide(fourth, true, first.cookie)).status !== 200) fail("An approved phone could not admit another");
  const memberApproved = await send("/api/table-membership", "POST", body, fourth.cookie);
  if (memberApproved.body.status !== "approved") fail("Member approval was not recorded");
  const admittedState = await send("/api/table-membership", "POST", body, second.cookie);
  const { count: cardsBefore } = await admin.from("loyalty_cards")
    .select("id", { count: "exact", head: true }).eq("restaurant_id", body.restaurantId);
  const stolenCard = await send("/api/loyalty/card", "POST", {
    restaurantId: body.restaurantId, pass: admittedState.body.pass,
  }, third.cookie);
  const { count: cardsAfter } = await admin.from("loyalty_cards")
    .select("id", { count: "exact", head: true }).eq("restaurant_id", body.restaurantId);
  if (stolenCard.status !== 403 || cardsAfter !== cardsBefore) fail("A rejected phone used another phone's table pass");
  const rejected = await send("/api/table-membership", "POST", body, third.cookie);
  if (rejected.body.status !== "rejected") fail("Rejected status was lost");
  if ((await send(billPath, "GET", null, third.cookie)).status !== 403) fail("A rejected phone read the bill");

  // A rejected phone cannot change its own row and ask again under the same credential.
  const { data: before } = await admin.from("table_session_members").select("status").eq("id", third.body.diner).single();
  if (before.status !== "rejected") fail("Rejection was not recorded");
  await admin.from("table_sessions").update({ closed_at: new Date().toISOString(), close_reason: "expired" }).eq("id", approved.sessionId);
  const fresh = await send("/api/table-membership", "POST", body);
  const next = await s.open(fresh.cookie);
  const nextOrder = await s.order(next.sessionId, next.diner);
  if ((await send(billPath, "GET", null, first.cookie)).status !== 403) fail("Earlier party read the new bill");
  const oldJoins = await send("/api/table-membership", "POST", body, first.cookie);
  if (oldJoins.body.status !== "pending") fail("Earlier party inherited admission");
  const own = await send(`${billPath}&sessionId=${approved.sessionId}`, "GET", null, first.cookie);
  if (own.status !== 200 || !own.body.orders.some(o => o.id === orderId) || own.body.orders.some(o => o.id === nextOrder)) fail("Old own food was hidden or mixed with the next party");
  const { data: restaurant, error: restaurantError } = await admin.from("restaurants")
    .select("stripe_account_id, stripe_charges_enabled").eq("id", body.restaurantId).single();
  if (restaurantError || (restaurant.stripe_account_id && restaurant.stripe_charges_enabled)) {
    fail("Admission payment case needs Demo Bistro without a card processor; refusing to open a real checkout");
  }
  const payment = await send("/api/bill/pay", "POST", { ...body, sessionId: approved.sessionId, orderIds: [orderId] }, first.cookie);
  // Seeded Demo Bistro has no processor. This reaches payment readiness, not admission.
  if (payment.status !== 409 || !/tarjeta|card payments/i.test(payment.body.error)) fail("An old member could not reach payment for its own food");
  const staleOrder = await send("/api/checkout", "POST", {
    ...body, payLater: true, diner: next.diner,
    items: [{ itemId: s.dish?.id ?? crypto.randomUUID(), qty: 1, mods: {} }],
  }, first.cookie);
  if (staleOrder.status !== 403) fail("An earlier phone could order onto the new party");
  const denied = await send("/api/split/join", "POST", { ...body, sessionId: next.sessionId, splitId: crypto.randomUUID(), diner: next.diner }, first.cookie);
  if (denied.status !== 403) fail("An old phone forged a new party's diner id");
  const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("table_id", table.id);
  if (count !== 2) fail("An unauthorized request changed the orders");
  return true;
}
