import { MARK, PART_AMOUNT, PART_TIP } from "../api-fixtures.mjs";
import { collectionReview } from "../api-collection-review.mjs";
import { collectionRefusals } from "../api-collection-refusals.mjs";
import { twoSittingCollection } from "../api-part-collection.mjs";
import { pendingWriteOff, pendingDiscount } from "./helpers.mjs";

export function paymentCounterCases(fx) {
  const { restaurant, unpaidOrder } = fx;
  const r = restaurant.id;
  return [
    { name: "POST /api/table-payment (counter)", as: "cashier", method: "POST",
      path: "/api/table-payment", body: { orderId: unpaidOrder, settlement: "cash" },
      expect: [200],
      check: async (d, f) => {
        if (d.orders !== 1) return `settled ${d.orders} order(s)`;
        // The order and its money are one write: paid, and in the ledger once.
        const [{ data: order }, { data: rows }] = await Promise.all([
          f.admin.from("orders").select("paid, total").eq("id", unpaidOrder).single(),
          f.admin.from("payments").select("amount, method, actor_email").eq("order_id", unpaidOrder),
        ]);
        if (!order?.paid) return "the order is not marked paid";
        if (rows?.length !== 1) return `${rows?.length ?? 0} payment(s) recorded for it`;
        if (Number(rows[0].amount) !== Number(order.total)) return `recorded MX$${rows[0].amount} of MX$${order.total}`;
        return rows[0].method === "cash" && rows[0].actor_email ? true : "recorded without its method or who took it";
      } },

    // Paid while it waits in "Listos": done, off the board by itself. And only
    // then — a paid order the kitchen is still cooking stays where it is.
    ...[["ready", "completed", "a ready order paid is completed"], ["preparing", "preparing", "an order still cooking stays where it is"]].map(([before, after, what]) => ({
      name: `POST /api/table-payment (${what})`, as: "cashier", method: "POST", path: "/api/table-payment",
      arrange: async f => {
        const { data } = await f.admin.from("orders").insert({
          restaurant_id: r, items: [{ itemId: "x", name: `${MARK} listos`, emoji: "🥗", price: 9, qty: 1, mods: {} }],
          subtotal: 9, service_fee: 0, tip: 0, tax_pct: 0, discount: 0, total: 9, currency: "MXN",
          note: MARK, status: before, paid: false,
        }).select("id").single();
        f.listosOrder = data?.id ?? "";
        return async () => {
          await f.admin.from("payments").delete().eq("order_id", f.listosOrder);
          await f.admin.from("orders").delete().eq("id", f.listosOrder);
        };
      },
      body: f => ({ orderId: f.listosOrder, settlement: "cash" }),
      expect: [200],
      check: async (_d, f) => {
        const { data } = await f.admin.from("orders").select("paid, status").eq("id", f.listosOrder).single();
        if (!data?.paid) return "the order was not paid";
        return data.status === after || `paid while ${before}, it is now ${data.status}, not ${after}`;
      },
    })),
  ];
}

export function billCollectionCases(fx) {
  const { table, walkoutOrder } = fx;
  // One reference per run, shared by the two cases below: the first collection
  // and the retry of that same collection. Fresh each run so a row a previous
  // run somehow left behind cannot make the first call look like the second.
  let partReview;
  const partRef = `${MARK}-part-${Date.now()}`;
  return [
    // ── the bill: discount, cancel, collect ──────────────────────────────
    // This asked for API-002, which has never existed anywhere. API-001 does,
    // briefly — the gate mints it, switches it off and deletes it, all before
    // this runs. So the waiter was told "no encontramos ese cupón", and the
    // chain behind it died quietly: no discount request was ever left, so the
    // manager's approval had nothing to approve and answered 400 for four
    // statuses' worth of permission.
    { name: "POST /api/bill/discount (waiter asks)", as: "waiter", method: "POST",
      path: "/api/bill/discount",
      body: async f => ({ tableId: f.discountTableId, code: f.discountCode }),
      expect: [200] },
    { name: "POST /api/bill/discount/approve", as: "manager", method: "POST",
      path: "/api/bill/discount/approve",
      // The manager approves the amount the ask shows, and nothing else.
      body: async f => {
        const requestId = await pendingDiscount(f);
        const { data } = await f.admin.from("discount_requests").select("amount").eq("id", requestId).maybeSingle();
        return { requestId, approve: true, reviewedAmount: Number(data?.amount) };
      },
      // There is a request pending now, so this approves one — and a 200 that
      // took nothing off the bill is the failure this gate exists to catch.
      expect: [200],
      check: async (_d, f) => {
        const { data } = await f.admin
          .from("orders").select("discount, coupon_code").eq("id", f.discountOrder).maybeSingle();
        return Number(data?.discount) > 0
          ? true
          : `approved, and the order still shows a discount of ${data?.discount}`;
      } },
    twoSittingCollection(),
    ...collectionRefusals(),
    // The calculator: a waiter collects part of a table's bill. A little of
    // it, so the bill stays open for the cases below.
    { name: "POST /api/table-payment/part", as: "waiter", method: "POST",
      path: "/api/table-payment/part",
      body: async f => { partReview ??= await collectionReview(f,table.id); return { tableId: table.id, ...partReview, amount: PART_AMOUNT, tip: PART_TIP, method: "cash", ref: partRef }; },
      expect: [200],
      // The gratuity is collected but never counts towards the food: a table
      // that tipped must not look nearer to settled than it is.
      check: d =>
        (d.collected >= PART_AMOUNT && d.tips >= PART_TIP && d.owed > 0 && d.settled === false) ||
        `collected ${d.collected}, tips ${d.tips}, owed ${d.owed}` },
    // The same collection again — a button tapped twice on a phone that seemed
    // not to respond. It must land in the ledger once.
    { name: "POST /api/table-payment/part (the same tap twice)", as: "waiter", method: "POST",
      path: "/api/table-payment/part",
      body: async f => { partReview ??= await collectionReview(f,table.id); return { tableId: table.id, ...partReview, amount: PART_AMOUNT, tip: PART_TIP, method: "cash", ref: partRef }; },
      expect: [200],
      check: d => d.duplicate === true || "the same collection was recorded twice" },
    // A tab opened before the reviewed balance sends neither the balance nor
    // the currency it showed. Nothing proves what it displayed, so it is asked
    // to refresh, and nothing reaches the ledger (audit L, finding 2).
    { name: "POST /api/table-payment/part (a tab from before the reviewed balance)", as: "waiter", method: "POST",
      path: "/api/table-payment/part",
      body: { tableId: table.id, amount: PART_AMOUNT, method: "cash", ref: `${partRef}-old` },
      expect: [409], expectError: /desactualizada|out of date/i },
    { name: "POST /api/table-payment/part (kitchen refused)", as: "kitchen", method: "POST",
      path: "/api/table-payment/part",
      body: { tableId: table.id, amount: PART_AMOUNT, method: "cash", ref: `${partRef}-k` },
      expect: [403] },
    // Part of this table is paid now, so its rest cannot be written off: that
    // would log the money that came in as lost (paths audit #5). Which
    // refusal matters: this one names what was paid.
    { name: "POST /api/bill/write-off (waiter asks, part paid)", as: "waiter", method: "POST",
      path: "/api/bill/write-off", body: { tableId: table.id, reason: "walkout", note: MARK },
      expect: [409], expectError: /ya se pagaron|already paid/i },
    { name: "POST /api/bill/write-off (waiter asks)", as: "waiter", method: "POST",
      path: "/api/bill/write-off", body: { orderIds: [walkoutOrder], reason: "walkout", note: MARK },
      expect: [200], check: d => d.pending === true || "a waiter's request should stay pending" },
    // The route reads `requestId`. This sent `id`, so it was refused on the
    // missing field every single run — the one path that decides whether a
    // restaurant absorbs a walkout had never executed.
    { name: "POST /api/bill/write-off/approve (refused)", as: "manager", method: "POST",
      path: "/api/bill/write-off/approve",
      // The id is remembered on the fixture so the check asks about the one
      // that was actually decided. "Is anything still pending?" is a different
      // question, and the answer is yes whenever another case has left one.
      body: async f => {
        f.decidedWriteOff = await pendingWriteOff(f);
        return { requestId: f.decidedWriteOff, approve: false };
      },
      expect: [200],
      check: async (_d, f) => {
        if (!f.decidedWriteOff) return "there was no request to decide";
        const { data } = await f.admin
          .from("write_off_requests").select("status").eq("id", f.decidedWriteOff).maybeSingle();
        return data && data.status !== "pending"
          ? true
          : `decided, and it is still "${data?.status ?? "gone"}"`;
      } },
    // A manager cancels what the table owes, and the table is CLEAR after it:
    // not just unpaid-and-written-off in the ledger, but off the kitchen board
    // and off the diner's phone. It used to leave every order at "received",
    // so the pass still had tickets for a table that had gone and the menu
    // still offered "follow your order ORD-09BB" three times over — on a table
    // the floor had just cleared for the next party.
    { name: "POST /api/bill/write-off (manager clears the table)", as: "manager", method: "POST",
      path: "/api/bill/write-off",
      body: { orderIds: [walkoutOrder], reason: "walkout", note: MARK },
      expect: [200],
      check: async (d, fx) => {
        if (d.pending) return "a manager's write-off should not need approving";
        const { data: o } = await fx.admin
          .from("orders").select("status, written_off").eq("id", walkoutOrder).single();
        if (!o?.written_off) return "the order was not written off";
        // Off the kitchen board and off the diner's phone, not merely marked in
        // the ledger. It used to stay at "preparing": the pass still had a
        // ticket for a table that had gone, and the menu still offered "follow
        // your order" on a table the floor had cleared for the next party.
        return ["completed", "cancelled"].includes(o.status)
          || `written off but still live on the board as "${o.status}"`;
      } },
  ];
}
