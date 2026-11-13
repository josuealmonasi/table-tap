import { expect, it } from "vitest";
import { fixture } from "./fixtures";
import { disputeOwnership } from "../ownership";

it("reconnection retains historical checkout ownership and account-checkout scope", async () => {
  const f = fixture(); f.tables.account_checkouts = [{ id: "ac", restaurant_id: "original", stripe_session_id: "cs", order_ids: ["order1", "order2"] }];
  expect(await disputeOwnership(f.db, "acct_old", false, "pi")).toEqual({ restaurantId: "original", matched: true,
    orderIds: ["order1", "order2"], checkoutId: "checkout", accountCheckoutId: "ac" });
});
it("payments and allocations recover a shared charge with no checkout", async () => {
  const f = fixture(); f.tables.diner_checkouts = [];
  f.tables.payments = [{ id: "pay", restaurant_id: "original", stripe_account_id: "acct_old", stripe_payment_intent: "pi", order_id: null }];
  f.tables.payment_allocations = ["order1", "order2"].map(order_id => ({ restaurant_id: "original", payment_id: "pay", order_id }));
  expect(await disputeOwnership(f.db, "acct_old", false, "pi")).toMatchObject({ restaurantId: "original", orderIds: ["order1", "order2"], matched: true });
});
it("unmatched cases use the event account's restaurant with no guessed order", async () => {
  const f = fixture(); f.tables.restaurants.push({ id: "review", stripe_account_id: "acct_other" });
  expect(await disputeOwnership(f.db, "acct_other", false, "pi")).toMatchObject({ restaurantId: "review", orderIds: [], matched: false });
  expect(await disputeOwnership(f.db, "acct_unknown", false, "pi")).toMatchObject({ restaurantId: null, orderIds: [], matched: false });
});
it("another mode cannot borrow checkout provenance", async () => {
  const f = fixture();
  expect(await disputeOwnership(f.db, "acct_old", true, "pi")).toMatchObject({ restaurantId: null, matched: false });
});
it("conflicting historical tenants fail closed", async () => {
  const f = fixture(); f.tables.payments = [{ id: "pay", restaurant_id: "other", stripe_account_id: "acct_old", stripe_payment_intent: "pi", order_id: "foreign" }];
  await expect(disputeOwnership(f.db, "acct_old", false, "pi")).rejects.toThrow("Conflicting dispute ownership");
});
