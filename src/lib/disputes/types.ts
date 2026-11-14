import type { createAdminClient } from "@/lib/supabase/admin";

export type DisputeDb = ReturnType<typeof createAdminClient>;
export const DISPUTE_EVENTS = new Set([
  "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed",
  "charge.dispute.funds_withdrawn", "charge.dispute.funds_reinstated",
]);
/** A case whose latest Stripe update was set aside after repeated failures
 * (stripe_dispute_events.state = 'review'): shown to the restaurant as
 * "Needs review", never as pending. Not the platform-only 'review' case. */
export const NEEDS_REVIEW = "needs_review";
export interface DisputeEvent {
  id: string;
  restaurant_id: string | null;
  stripe_account_id: string;
  livemode: boolean;
  stripe_dispute_id: string;
  stripe_event_id: string;
  created_at: string;
  claim_token: string;
}
export interface DisputeCase {
  id: string;
  restaurant_id: string;
  stripe_account_id: string;
  livemode: boolean;
  stripe_dispute_id: string;
  stripe_payment_intent: string | null;
  order_id: string | null;
  amount_minor: number;
  currency: string;
  status: string;
  provider_created_at: string;
  reconciliation_state: string;
}
export interface DisputeMovement {
  dispute_id: string;
  stripe_account_id: string;
  livemode: boolean;
  stripe_balance_transaction_id: string;
  amount_minor: number;
  fee_minor: number;
  net_minor: number;
  currency: string;
  provider_created_at: string;
}
export interface DisputeCurrencySummary {
  currency: string;
  withdrawn: number;
  reinstated: number;
  fees: number;
  net: number;
  exposure: number;
}
export interface DisputeReport {
  currencies: DisputeCurrencySummary[];
  pending: number;
  /** Cases waiting on a person, not on Stripe: their update failed repeatedly. */
  review: number;
  won: number;
  lost: number;
}
export interface DisputeHistory extends DisputeCase {
  shared: boolean;
  movements: DisputeMovement[];
}
