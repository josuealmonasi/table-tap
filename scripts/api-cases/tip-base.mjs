import { randomUUID } from "node:crypto";
import { splitSlotFixture } from "../split-slots-fixture.mjs";
import { chargeAccountFixture } from "../disposable-account-fixtures.mjs";
import { ordersTipBase, frozenTipPrincipal, splitTipBase, tipFromPercent } from "../api-tip-helper.mjs";

const checked = async query => {
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

/** Fake Connect accounts refuse at Stripe; inspect the exact durable Stripe request, never just the 502.
 * @param {"bill" | "split" | "slots" | "account"} kind
 */
export function tipBaseCase(kind) {
  const paths = { bill: "/api/bill/pay", split: "/api/split/pay", slots: "/api/split/pay", account: "/api/account/pay" };
  return {
    name: `POST /api/${kind === "slots" ? "split" : kind}/pay (food-only percentage tip)`,
    as: "diner", method: "POST", path: paths[kind],
    arrange: async f => {
      const fixture = await splitSlotFixture(f.admin, f.restaurant.id, { totalCents: 12000, start: false });
      let reader, accountId, laterId, cardsBefore;
      const cleanup = async () => {
        try {
          const attempts = await checked(f.admin.from("diner_checkouts").select("id, metadata")
            .contains("order_ids", [fixture.orderId]));
          await checked(f.admin.from("bill_splits").delete().eq("session_id", fixture.scope.sessionId));
          if (attempts.length) await checked(f.admin.from("diner_checkouts").delete().in("id", attempts.map(a => a.id)));
          const fees = attempts.map(a => a.metadata?.fee_id).filter(Boolean);
          if (fees.length) await checked(f.admin.from("platform_fees").delete().in("id", fees));
          if (accountId) {
            // The account variant runs in the disposable account restaurant: its
            // journal keeps the charged order, the account and the sitting
            // until the restaurant cascade removes them all at the end of the run.
            await checked(f.admin.from("account_checkouts").delete().eq("account_id", accountId));
            // Every later account case shares this restaurant: "no card
            // reader" must find it without one again.
            await checked(f.admin.from("restaurants").update(cardsBefore).eq("id", f.restaurant.id));
            return;
          }
          if (laterId) await checked(f.admin.from("orders").delete().eq("id", laterId));
          await fixture.cleanup();
        } finally { if (reader) await reader(); }
      };
      try {
        // The disposable account restaurant is thrown away whole, reader included.
        if (kind === "account") cardsBefore = await checked(f.admin.from("restaurants")
          .select("stripe_account_id, stripe_charges_enabled").eq("id", f.restaurant.id).single());
        if (kind === "account") await checked(f.admin.from("restaurants")
          .update({ stripe_account_id: "acct_api_check_account", stripe_charges_enabled: true }).eq("id", f.restaurant.id));
        else reader = await f.withCardReader();
        if (kind === "bill" || kind === "split") await checked(f.admin.from("table_sessions")
          .update({ opened_by: null }).eq("id", fixture.scope.sessionId));
        const food = { total: 120, service_fee: 10, tip: 10 };
        await checked(f.admin.from("orders").update({ ...food, subtotal: 120, discount: 20,
          created_at: new Date(Date.now() - 120000).toISOString() }).eq("id", fixture.orderId));
        let body = { ...fixture.scope, orderIds: [fixture.orderId], tipPct: 10, diner: "apicheck-tip" };
        let base = ordersTipBase([food]);
        if (kind === "slots") {
          await fixture.begin();
          body = { ...body, splitId: fixture.splitId, revision: 1, slots: [0], expectedCents: 6000 };
          base = splitTipBase(frozenTipPrincipal(110, [food]), 2, [0]);
        } else if (kind === "split") {
          const split = await checked(f.admin.from("bill_splits").insert({ restaurant_id: f.restaurant.id,
            session_id: fixture.scope.sessionId, shares: 2, status: "locked", amount: 120, food_principal: 110,
            order_ids: [fixture.orderId], proposed_by: "apicheck-tip", locked_at: new Date(Date.now() - 60000).toISOString(),
          }).select("id").single());
          await checked(f.admin.from("bill_split_claims").insert({ split_id: split.id, share_no: 0, diner: "apicheck-tip", amount: 60 }));
          const later = { total: 25, service_fee: 2, tip: 3 };
          const row = await checked(f.admin.from("orders").insert({ ...later, restaurant_id: f.restaurant.id,
            table_id: fixture.scope.tableId, session_id: fixture.scope.sessionId, diner: "apicheck-tip", items: [],
            subtotal: 20, discount: 0, currency: "MXN", status: "received", paid: false,
          }).select("id").single());
          laterId = row.id;
          body = { ...body, splitId: split.id, ownOrderIds: [laterId] };
          base = splitTipBase(frozenTipPrincipal(110, [food]), 2, [0], ordersTipBase([later]));
        } else if (kind === "account") {
          const code = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
          const account = await checked(f.admin.from("customer_accounts").insert({ restaurant_id: f.restaurant.id,
            name: "apicheck-tip", code, credit_limit: 1000, opened_by: "apicheck-tip",
          }).select("id").single());
          accountId = account.id;
          await chargeAccountFixture(f.admin, f.restaurant.id, accountId, [fixture.orderId], 120, "apicheck-tip");
          body = { c: code, expected: 120, currency: "MXN", tipPct: 10 };
        }
        f.tipBaseCase = { body, fixture, accountId, tip: tipFromPercent(base, 10) };
        return cleanup;
      } catch (error) { await cleanup(); throw error; }
    },
    body: f => f.tipBaseCase.body,
    expect: [502], expectError: /checkout|cobro|pago/i,
    effect: async f => {
      const c = f.tipBaseCase;
      if (kind === "account") {
        const rows = await checked(f.admin.from("account_checkouts").select("tip").eq("account_id", c.accountId));
        return rows.length === 1 && Number(rows[0].tip) === c.tip || "account checkout tip disagrees with food-only preview";
      }
      const attempts = await checked(f.admin.from("diner_checkouts").select("stripe_params, stripe_session_id, stripe_account_id")
        .contains("order_ids", [c.fixture.orderId]));
      if (attempts.length !== 1) return `expected one Stripe request, found ${attempts.length}`;
      const [attempt] = attempts;
      let metadata = attempt.stripe_params?.metadata;
      if (attempt.stripe_session_id) {
        const { default: Stripe } = await import("stripe");
        const session = await new Stripe(process.env.STRIPE_SECRET_KEY).checkout.sessions.retrieve(attempt.stripe_session_id,
          {}, { stripeAccount: attempt.stripe_account_id });
        metadata = session.metadata;
      }
      return Number(metadata?.settle_tip) === c.tip || `Stripe tip ${metadata?.settle_tip}, preview ${c.tip}`;
    },
  };
}
