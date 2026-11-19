import type { DisputeCase, DisputeMovement } from "../types";

export const dispute: DisputeCase = { id: "case", restaurant_id: "r", stripe_account_id: "acct", livemode: false,
  stripe_dispute_id: "dp", stripe_payment_intent: "pi", order_id: "order", amount_minor: 10000, currency: "MXN",
  status: "won", provider_created_at: "2025-01-01T00:00:00.000Z", reconciliation_state: "pending" };
export const movement: DisputeMovement = { dispute_id: "case", stripe_account_id: "acct", livemode: false,
  stripe_balance_transaction_id: "txn", amount_minor: -10000, fee_minor: 1500, net_minor: -11500,
  currency: "MXN", provider_created_at: "2026-11-10T00:00:00.000Z" };
