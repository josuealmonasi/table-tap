import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import { disputeReport, tenantBooks } from "./report";
import { disputeOwnership } from "./ownership";
import type { DisputeCase, DisputeHistory, DisputeMovement, DisputeDb } from "./types";

/** Call only after an existing manager gate. All private reads are tenant-scoped. */
export async function readDisputes(db: DisputeDb, restaurant: string) {
  const live = /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY ?? "");
  const [allCases, allMovements, events] = await Promise.all([
    everyRow<DisputeCase>((a, b) => db.from("stripe_disputes")
      .select("id, restaurant_id, stripe_account_id, livemode, stripe_dispute_id, stripe_payment_intent, order_id, amount_minor, currency, status, provider_created_at, reconciliation_state")
      .eq("restaurant_id", restaurant).eq("livemode", live).order("id").range(a, b), "disputes"),
    everyRow<DisputeMovement>((a, b) => db.from("stripe_dispute_movements")
      .select("dispute_id, stripe_account_id, livemode, stripe_balance_transaction_id, amount_minor, fee_minor, net_minor, currency, provider_created_at")
      .eq("restaurant_id", restaurant).eq("livemode", live).order("id").range(a, b), "dispute movements"),
    everyRow<{ stripe_dispute_id: string; stripe_account_id: string; livemode: boolean }>((a, b) => db.from("stripe_dispute_events")
      .select("stripe_dispute_id, stripe_account_id, livemode").eq("restaurant_id", restaurant).eq("livemode", live).neq("state", "done")
      .order("id").range(a, b), "pending dispute events"),
  ]);
  const { cases, movements } = tenantBooks(allCases, allMovements);
  const key = (d: { livemode: boolean; stripe_account_id: string; stripe_dispute_id: string }) => `${d.livemode}:${d.stripe_account_id}:${d.stripe_dispute_id}`;
  // A later notification on a review case is platform work, not the tenant's.
  const reviewed = new Set(allCases.filter(d => d.reconciliation_state === "review").map(key));
  const pending = new Set([...events.filter(e => !reviewed.has(key(e))), ...cases.filter(d => d.reconciliation_state !== "reconciled")].map(key)).size;
  const waiting = new Set(events.map(key));
  return { cases: cases.map(d => waiting.has(key(d)) && d.reconciliation_state === "reconciled"
    ? { ...d, reconciliation_state: "pending" } : d), movements, pending };
}

export async function readDisputeReport(restaurant: string, since: string, until: string) {
  const { cases, movements, pending } = await readDisputes(createAdminClient(), restaurant);
  return disputeReport(cases, movements, since, until, pending);
}

/** Shared charges appear against each covered order but are never summed here. */
export async function readDisputeHistory(db: DisputeDb, restaurant: string, orderIds: string[]): Promise<Record<string, DisputeHistory[]>> {
  const { cases, movements } = await readDisputes(db, restaurant);
  const result: Record<string, DisputeHistory[]> = Object.fromEntries(orderIds.map(id => [id, []]));
  for (const dispute of cases) {
    if (dispute.reconciliation_state === "review") continue; // No guessed food links.
    const owner = await disputeOwnership(db, dispute.stripe_account_id, dispute.livemode, dispute.stripe_payment_intent, restaurant);
    if (owner.restaurantId !== restaurant || !owner.matched) continue;
    const linked = [...new Set([...(dispute.order_id ? [dispute.order_id] : []), ...owner.orderIds])];
    for (const order of linked.filter(id => orderIds.includes(id))) {
      result[order].push({ ...dispute, shared: linked.length > 1, movements: movements.filter(m => m.dispute_id === dispute.id).sort((a, b) => a.provider_created_at.localeCompare(b.provider_created_at)) });
    }
  }
  Object.values(result).forEach(rows => rows.sort((a, b) => b.provider_created_at.localeCompare(a.provider_created_at)));
  return result;
}
