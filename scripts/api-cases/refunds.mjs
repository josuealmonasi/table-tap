import { MARK } from "../api-fixtures.mjs";
import { returnFor } from "./helpers.mjs";

export function refundListCases() {
  return [
    { name: "order returns list", path: "/api/order-refunds", method: "GET", as: "owner", expect: [200] },
    { name: "unknown order return cannot be confirmed", path: "/api/order-refunds", method: "POST", as: "owner", body: { id: "00000000-0000-0000-0000-000000000000" }, expect: [404] },
    { name: "historical receipt attribution list", path: "/api/payment-attribution", method: "GET", as: "owner", expect: [200] },
    { name: "empty receipt attribution refused", path: "/api/payment-attribution", method: "POST", as: "owner", body: {}, expect: [400] },
  ];
}

export function refundDueCases(fx) {
  const { restaurant } = fx;
  const r = restaurant.id;
  return [
    // A card payment that landed on a bill already collected, given back from
    // Cuentas abiertas. The demo has no real Stripe account, so the healthy
    // answer is Stripe's refusal — and the assertion is the half that matters:
    // a refund Stripe never made is not marked done, so the row stays owed.
    { name: "POST /api/refunds-due (Stripe refuses: the payment stays owed)", as: "manager",
      method: "POST", path: "/api/refunds-due",
      arrange: async f => {
        const putReaderBack = await f.withCardReader();
        const { data } = await f.admin.from("refunds_due").insert({
          restaurant_id: r, stripe_payment_intent: `pi_${MARK}_${crypto.randomUUID()}`,
          amount: 12.5, table_label: MARK,
        }).select("id").single();
        f.refundDueId = data?.id ?? "";
        return async () => {
          await f.admin.from("refunds_due").delete().eq("id", f.refundDueId);
          await putReaderBack();
        };
      },
      body: f => ({ id: f.refundDueId }),
      expect: [502], expectError: /no hizo el reembolso|did not make the refund/i,
      effect: async f => {
        const { data } = await f.admin
          .from("refunds_due").select("refunded_at").eq("id", f.refundDueId).maybeSingle();
        return data && data.refunded_at === null
          ? true
          : `a refund Stripe never made was marked done (${data?.refunded_at ?? "row gone"})`;
      } },
    // Customer completion must not turn an outstanding fee retry into 409.
    // The demo account cannot answer Stripe: the fee stays pending and the
    // customer's original completion evidence must survive both requests.
    { name: "POST /api/refunds-due (completed customer refund retries its outstanding fee)", as: "manager",
      method: "POST", path: "/api/refunds-due",
      arrange: async f => {
        const restore = await f.withCardReader();
        const { data, error } = await f.admin.from("refunds_due").insert({
          restaurant_id: r, stripe_payment_intent: `pi_${MARK}_${crypto.randomUUID()}`,
          amount: 12.5, currency: "USD", table_label: MARK,
          refunded_at: "2026-10-01T12:00:00Z", stripe_refund_id: "re_api_customer_completed",
        }).select("id").single();
        if (error) { await restore(); throw new Error(error.message); }
        f.feeRetryId = data.id;
        return async () => {
          await f.admin.from("refunds_due").delete().eq("id", f.feeRetryId);
          await restore();
        };
      },
      body: f => ({ id: f.feeRetryId }), expect: [200],
      check: async (answer, f) => {
        const retry = await fetch(`${f.base}/api/refunds-due`, {
          method: "POST", headers: { "Content-Type": "application/json", Cookie: f.who.manager },
          body: JSON.stringify({ id: f.feeRetryId }),
        });
        const second = await retry.json();
        const { data } = await f.admin.from("refunds_due")
          .select("refunded_at, stripe_refund_id, fee_reconciled_at").eq("id", f.feeRetryId).single();
        return answer.feePending === true && retry.status === 200 && second.feePending === true
          && data?.stripe_refund_id === "re_api_customer_completed"
          && new Date(data.refunded_at).toISOString() === "2026-10-01T12:00:00.000Z"
          && data.fee_reconciled_at === null || `fee retry lost its pending state or customer evidence: ${JSON.stringify({ answer, second, data })}`;
      } },
    { name: "POST /api/refunds-due (one already given back)", as: "manager",
      method: "POST", path: "/api/refunds-due",
      arrange: async f => {
        const { data } = await f.admin.from("refunds_due").insert({
          restaurant_id: r, stripe_payment_intent: `pi_${MARK}_${crypto.randomUUID()}`,
          amount: 12.5, table_label: MARK, refunded_at: new Date().toISOString(), fee_reconciled_at: new Date().toISOString(),
        }).select("id").single();
        f.refundedId = data?.id ?? "";
        return async () => { await f.admin.from("refunds_due").delete().eq("id", f.refundedId); };
      },
      body: f => ({ id: f.refundedId }),
      expect: [409], expectError: /ya se reembolsó|already refunded/i },
  ];
}

export function orderRefundCases(fx) {
  const { tableOrder } = fx;
  return [
    { name: "POST /api/orders/cancel", as: "owner", method: "POST", path: "/api/orders/cancel",
      body: { id: tableOrder }, expect: [200] },
    // On an account the customer is paying online: Stripe will charge the
    // orders the payment opened for, so one cancelled in between would be
    // paid for anyway. Refused until the payment lands or runs out.
    { name: "POST /api/orders/cancel (an account being paid online)", as: "owner", method: "POST",
      path: "/api/orders/cancel",
      arrange: async f => {
        await f.admin.from("orders").update({ account_id: fx.accountId }).eq("id", fx.acctOrder2);
        await f.admin.from("customer_accounts")
          .update({ checkout_until: new Date(Date.now() + 10 * 60_000).toISOString() }).eq("id", fx.accountId);
        return async () => {
          await f.admin.from("customer_accounts").update({ checkout_until: null }).eq("id", fx.accountId);
          await f.admin.from("orders").update({ account_id: null }).eq("id", fx.acctOrder2);
        };
      },
      body: { id: fx.acctOrder2 }, expect: [409], expectError: /pago en línea|online payment/i,
      effect: async f => {
        const { data } = await f.admin.from("orders").select("status").eq("id", fx.acctOrder2).single();
        return data.status !== "cancelled" || "the order was cancelled while its account was being paid";
      } },
    // Cash is not a card that has not settled yet. Treating it as one made a
    // cash sale impossible to cancel — the owner was told "payment is still
    // settling, try again" for ever, on an order the board kept showing, while
    // the screen offered to refund it.
    { name: "GET  /api/orders/cancel (cash: a person gives it back)", as: "owner", method: "GET",
      path: f => `/api/orders/cancel?id=${f.cashPaidOrder}`, expect: [200],
      check: (d, f) => (d.cash === f.linePrice && d.refund === 0) || `answered ${JSON.stringify(d)}` },
    { name: "POST /api/orders/cancel (paid in cash)", as: "owner", method: "POST",
      path: "/api/orders/cancel", body: async f => ({ id: f.cashPaidOrder }), expect: [200],
      check: async (_d, f) => {
        const { data: o } = await f.admin
          .from("orders").select("status").eq("id", f.cashPaidOrder).maybeSingle();
        if (o?.status !== "cancelled") return `answered 200 and left it "${o?.status}"`;
        // The money genuinely arrived, so the payment stays. The ledger expects
        // exactly this: its check for money against an unsettled order skips
        // cancelled ones on purpose.
        const { data: paid } = await f.admin
          .from("payments").select("amount").eq("order_id", f.cashPaidOrder);
        if (!paid?.length) return "the cancel took the cash payment off the ledger with it";
        const back = await returnFor(f, f.cashPaidOrder);
        return back?.source === "cash" && back.status === "pending" && Number(back.amount) === Number(paid[0].amount)
          || "the cancellation did not reserve a pending cash return";
      } },
    { name: "POST /api/order-refunds (manager confirms cash actually returned)", as: "owner", method: "POST",
      path: "/api/order-refunds", body: async f => ({ id: (await returnFor(f, f.cashPaidOrder))?.id, confirmReturned: true, drawer: "original" }), expect: [200],
      check: async (d, f) => {
        const back = await returnFor(f, f.cashPaidOrder);
        return d.completed && back?.status === "succeeded" && back.confirmed_by === "demo@tabletap.dev" && back.payout_actor === "demo@tabletap.dev"
          || "the return was not confirmed with its manager and payout drawer";
      } },

    // What the dialog asks before it words its offer. Each answer is the one
    // the POST below then acts on — the two read the same plan.
    { name: "GET /api/orders/cancel (paid flag without receipt needs attribution)", as: "owner", method: "GET",
      path: f => `/api/orders/cancel?id=${f.sittingPaidOrder}`, expect: [409], expectError: /atribuy|attribution/i },
    { name: "GET  /api/orders/cancel (POS card: the terminal, not Stripe)", as: "owner", method: "GET",
      path: f => `/api/orders/cancel?id=${f.posCardOrder}`, expect: [200],
      check: (d, f) => (d.terminal === f.linePrice && d.refund === 0) || `answered ${JSON.stringify(d)}` },
    { name: "GET  /api/orders/cancel (a table's online bill: Stripe)", as: "owner", method: "GET",
      path: f => `/api/orders/cancel?id=${f.tableBillOrder}`, expect: [200],
      check: (d, f) => (d.withTable === f.linePrice && d.refund === 0) || `answered ${JSON.stringify(d)}` },
    { name: "GET  /api/orders/cancel (waiter refused)", as: "waiter", method: "GET",
      path: f => `/api/orders/cancel?id=${f.posCardOrder}`, expect: [403] },
    // Card on the restaurant's own terminal. This answered "payment still
    // settling — try again" for ever, while the dialog promised a refund.
    { name: "POST /api/orders/cancel (POS card sale)", as: "owner", method: "POST",
      path: "/api/orders/cancel", body: async f => ({ id: f.posCardOrder }), expect: [200],
      check: async (_d, f) => {
        const back = await returnFor(f, f.posCardOrder);
        return back?.source === "terminal" && back.status === "pending" && Number(back.amount) === f.linePrice
          || "the terminal return was not reserved pending confirmation";
      } },
    // The receipt predates a verified connected-account snapshot. Cancelling
    // preserves an explicit review obligation rather than guessing an account.
    { name: "POST /api/orders/cancel (unverified Stripe provenance needs review)", as: "owner", method: "POST",
      path: "/api/orders/cancel", body: async f => ({ id: f.tableBillOrder }), expect: [200],
      effect: async f => {
        const back = await returnFor(f, f.tableBillOrder);
        return back?.status === "review" && back.source === "review" || "the old charge's account was guessed";
      } },
    { name: "POST /api/orders/cancel (unattributed historical paid flag)", as: "owner", method: "POST",
      path: "/api/orders/cancel", body: async f => ({ id: f.sittingPaidOrder }), expect: [409], expectError: /atribuy|attribution/i },
  ];
}
