import { returnFixture } from "./returns-contract-fixtures";

/** The read contract, not a simulation of SQL evidence deduplication. */
export function eventQuery(fixture: ReturnType<typeof returnFixture>, args: { p_restaurant: string; p_currency: string | null }) {
  let query = fixture.from("return_events").eq("restaurant_id", args.p_restaurant);
  if (args.p_currency) query = query.eq("currency", args.p_currency);
  return query;
}

/** Existing full-completion cases have one success per operation. New partial
 * cases supply explicit events so the mocks cannot hide the date difference. */
export function completedEventQuery(fixture: ReturnType<typeof returnFixture>, args: { p_restaurant: string; p_currency: string | null }) {
  fixture.tables.return_events = (fixture.tables.refund_operations ?? []).filter(o => o.status === "succeeded").map(o => ({
    ...o, id: `event-${o.id}`, operation_id: o.id, order_id: "12345678-order", kind: o["order_adjustments.kind"] ?? "return",
    amount_cents: Math.round(Number(o.amount) * 100), succeeded_at: o.completed_at,
  }));
  return eventQuery(fixture, args);
}
