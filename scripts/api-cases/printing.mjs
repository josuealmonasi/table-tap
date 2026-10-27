import { MARK } from "../api-fixtures.mjs";
import { printReprintRace } from "../api-print-delivery.mjs";
import { kitchenTicketId, anyOrderId } from "./helpers.mjs";

export function printerDeliveryCases() {
  return [
    // The printer's address is a credential: a manager may mint one, a cashier
    // may not, and a wrong one is told nothing it did not already know.
    { name: "POST /api/print/token (cashier refused)", as: "cashier", method: "POST",
      path: "/api/print/token", expect: [403] },
    { name: "POST /api/print/token", as: "manager", method: "POST", path: "/api/print/token",
      expect: [200],
      check: d => (typeof d.token === "string" && d.token.length >= 40) || "returned no token" },
    { name: "POST /api/print/cloudprnt (wrong address)", as: "diner", method: "POST",
      path: "/api/print/cloudprnt/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", expect: [200],
      // Not an error, and not a hint: the same "nothing waiting" a real
      // printer gets on a quiet counter.
      check: d => d.jobReady === false || "a wrong address was offered a job" },
    { name: "GET  /api/print/cloudprnt (wrong address)", as: "diner", method: "GET",
      path: "/api/print/cloudprnt/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", expect: [404] },
    { name: "DELETE /api/print/cloudprnt (wrong address)", as: "diner", method: "DELETE",
      path: "/api/print/cloudprnt/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", expect: [404] },
    // And the other half, which nothing checked: that a RIGHT address works.
    // Both cases above are satisfied by a route that refuses everyone, and for
    // a while that is exactly what any change to this file would have produced
    // without a word — the seed configured no printer, so there was no token
    // to call it with.
    { name: "POST /api/print/cloudprnt (the printer's own address)", as: "diner",
      method: "POST", path: async f => `/api/print/cloudprnt/${await f.printToken()}`, expect: [200],
      check: (d, f) => d.jobReady === true && d.jobToken === f.printDeliveryToken
        || "a real printer was not offered the fixture's own delivery" },
    { name: "GET  /api/print/cloudprnt (collects its ticket)", as: "diner", method: "GET",
      path: async f => `/api/print/cloudprnt/${await f.printToken()}?token=${f.printDeliveryToken}`, expect: [200],
      // Plain text, not JSON: this is what comes out on paper.
      checkText: t => (t.includes(MARK) || t.length > 20) || `the paper came out empty: ${JSON.stringify(t.slice(0, 40))}`,
      // A kitchen ticket is dishes. A printer is not a login, and money has no
      // business on a roll of paper in a corridor.
      },
    { name: "GET  /api/print/cloudprnt (no money on the paper)", as: "diner", method: "GET",
      path: async f => `/api/print/cloudprnt/${await f.printToken()}?token=${f.printDeliveryToken}`, expect: [200],
      checkText: t => !/MX\$|tarjeta|\bcard\b|total:/i.test(t) || "the kitchen ticket carries money" },
    // The printer reports how it went; a failure must leave the ticket queued.
    // Every confirmation used to close the job, so a printer out of paper
    // (code 520) dropped the order from the queue unprinted.
    { name: "DELETE /api/print/cloudprnt (a failed print keeps the job)", as: "diner", method: "DELETE",
      path: async f => `/api/print/cloudprnt/${await f.printToken()}?token=${f.printDeliveryToken}&code=520%20Paper%20Empty`,
      expect: [200],
      check: async (_d, f) => {
        const { data } = await f.admin.from("print_jobs").select("printed_at").eq("id", f.printJobId).maybeSingle();
        return !data?.printed_at || "a print the printer said failed was closed as printed";
      } },
    { name: "DELETE /api/print/cloudprnt (closes the job it was handed)", as: "diner",
      method: "DELETE",
      path: async f => `/api/print/cloudprnt/${await f.printToken()}?token=${f.printDeliveryToken}`,
      expect: [200],
      check: async (_d, f) => {
        const { data } = await f.admin
          .from("print_jobs").select("printed_at").eq("id", f.printJobId).maybeSingle();
        return data?.printed_at ? true : "the ticket came out and the job stayed open — it would reprint for ever";
      } },
  ];
}

export function orderPrintCases() {
  return [
    // Paper for an order that already exists, from the board or the history.
    { name: "POST /api/orders/print (kitchen, no printer)", as: "waiter", method: "POST",
      path: "/api/orders/print",
      body: async f => ({ orderId: await anyOrderId(f), to: "kitchen" }),
      // A restaurant with no printer address must be told, not queued for a
      // machine that will never ask. 200 once one is configured.
      expect: [200, 409] },
    { name: "POST /api/orders/print (kitchen cannot print receipts)", as: "kitchen", method: "POST",
      path: "/api/orders/print",
      body: async f => ({ orderId: await kitchenTicketId(f, f.printableOrder), to: "receipt" }),
      expect: [403],
      effect: async f => {
        const { data, error } = await f.admin.from("print_jobs").select("printed_at")
          .eq("id", f.printJobId).single();
        return !error && data?.printed_at !== null || "the receipt refusal re-armed the kitchen job";
      } },
    { name: "POST /api/orders/print (kitchen reprint still works)", as: "kitchen", method: "POST",
      path: "/api/orders/print",
      body: async f => ({ orderId: await kitchenTicketId(f, f.printableOrder), to: "kitchen" }),
      expect: [200], check: d => d.queued === true && !d.html || "no kitchen ticket was queued",
      effect: async f => {
        const { data } = await f.admin.from("print_jobs").select("claimed_at, printed_at")
          .eq("order_id", f.printableOrder).eq("kind", "kitchen").single();
        return data && data.claimed_at === null && data.printed_at === null || "the print job was not re-armed";
      } },
    printReprintRace(),
    { name: "POST /api/orders/print (receipt)", as: "waiter", method: "POST",
      path: "/api/orders/print",
      body: async f => ({ orderId: await anyOrderId(f), to: "receipt" }),
      expect: [200],
      check: d => (typeof d.html === "string" && d.html.length > 40) || "returned no receipt" },
    { name: "POST /api/orders/print (another restaurant's order)", as: "waiter", method: "POST",
      path: "/api/orders/print",
      body: { orderId: "00000000-0000-4000-8000-000000000000", to: "receipt" },
      expect: [404] },
    { name: "POST /api/orders/print (bad target)", as: "waiter", method: "POST",
      path: "/api/orders/print",
      body: async f => ({ orderId: await anyOrderId(f), to: "wherever" }),
      expect: [400] },
  ];
}
