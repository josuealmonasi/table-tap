/** Credits reduce debt. They must never be mistaken for receipt coverage. */
export function checkAccountCredits(adjustments, orders, logs, cents, bad) {
  const credits = adjustments.filter(a => a.kind === "account_credit");
  const refs = new Set();
  for (const a of credits) {
    const key = `${a.restaurant_id}:${a.request_id}`;
    const order = orders.find(o => o.id === a.order_id && o.restaurant_id === a.restaurant_id);
    const events = logs.filter(l => l.id === a.id && l.restaurant_id === a.restaurant_id
      && l.entity === "bill" && l.action === "written_off");
    const fields = Object.fromEntries((events[0]?.detail ?? "").split(" ").map(v => v.split("=")));
    if (!order?.account_id || refs.has(key) || !a.request_id || !a.request
      || !Number.isInteger(a.amount_cents) || a.amount_cents <= 0
      || cents(a.forgiven) !== a.amount_cents
      || cents(a.previous_total) - cents(a.resulting_total) !== a.amount_cents
      || !["MXN", "USD"].includes(a.currency)
      || !["walkout", "comp", "error", "other"].includes(a.reason)
      || events.length !== 1 || fields.kind !== "account_credit" || fields.currency !== a.currency
      || fields.reason !== a.reason || cents(fields.amount) !== a.amount_cents) bad(`account credit ${a.id} does not reconcile`);
    for (const component of ["tip", "service_fee"]) {
      if (a[`previous_${component}`] == null || a[`resulting_${component}`] == null
        || cents(a[`resulting_${component}`]) < 0
        || cents(a[`resulting_${component}`]) > cents(a[`previous_${component}`])) bad(`account credit ${a.id} has invalid ${component}`);
    }
    if (cents(a.resulting_tip) + cents(a.resulting_service_fee) > cents(a.resulting_total)) bad(`account credit ${a.id} exceeds principal`);
    refs.add(key);
  }
  for (const order of orders.filter(o => !o.paid && o.status !== "cancelled")) {
    const mine = credits.filter(a => a.order_id === order.id && a.restaurant_id === order.restaurant_id)
      .sort((a, b) => cents(a.previous_total) - cents(b.previous_total));
    if (!mine.length) continue;
    if (cents(order.total) !== cents(mine[0].resulting_total)
      || Boolean(order.written_off) !== (cents(order.total) === 0)) bad(`credited account order ${order.id} has incorrect debt`);
  }
}
