

export function webhooksCases() {
  return [
    // ── the webhooks: no signature, no entry ─────────────────────────────
    //
    // There are two, because there are two Stripe accounts: our own carries
    // the subscriptions, and each restaurant's carries the food a diner pays
    // for as a direct charge. Each endpoint verifies against its own secret.
    { name: "POST /api/webhooks/stripe (no signature)", as: "diner", method: "POST",
      path: "/api/webhooks/stripe", body: { type: "customer.subscription.updated" },
      // Accepting this would let anyone put a restaurant on any plan.
      expect: [400, 401, 403] },
    { name: "POST /api/webhooks/stripe/connect (no signature)", as: "diner", method: "POST",
      path: "/api/webhooks/stripe/connect", body: { type: "checkout.session.completed" },
      // Accepting this would let anyone mark orders as paid.
      expect: [400, 401, 403] },
  ];
}
