import { receiptCents } from "@/lib/receipt-amount";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { closeSessionsFor } from "@/lib/table-session";
import type { Order } from "@/lib/types";

/** What each order already has paid against it, or null when that could not be read. */
export async function coverageByOrder(restaurantId: string, orderIds: string[]): Promise<Map<string, number> | null> {
  const db = createAdminClient();
  const paid = new Map<string, number>();
  for (const id of orderIds) {
    const { data, error } = await db.rpc("retained_order_coverage", { p_restaurant: restaurantId, p_order: id });
    if (error) return null;
    paid.set(id, receiptCents(Number(data ?? 0)) / 100);
  }
  return paid;
}

export { owedCents } from "@/lib/write-off-cents";

export type RestOutcome =
  | { outcome: "forgiven"; forgivenCents: number; writtenOffCents: number; orderIds: string[] }
  | { outcome: "repeat"; forgivenCents: number }
  | { outcome: "changed" | "paying" | "split" | "unresolved" | "conflict" | "invalid" | "failed" };

/**
 * Writes a walked-out table off when part of it was paid (paths audit #5
 * follow-up): the orders with money against them are forgiven only the rest,
 * the ones with none are written off whole, in one transaction
 * (`write_off_remainder_v1`). What was paid stays paid; what is lost is only
 * what nobody paid. An approval passes its request, which the same transaction
 * marks decided.
 */
export async function applyWriteOffRest(p: {
  orders: Pick<Order, "id">[]; restaurantId: string; actorEmail: string; reason: string; note: string;
  expectedCents: number; currency: string; requestId?: string;
}): Promise<RestOutcome> {
  const { data, error } = await createAdminClient().rpc("write_off_remainder_v1", {
    p_restaurant: p.restaurantId, p_orders: p.orders.map(o => o.id), p_expected_cents: p.expectedCents,
    p_currency: p.currency, p_actor: p.actorEmail, p_reason: p.reason, p_note: p.note || null,
    p_ref: randomUUID(), p_request: p.requestId ?? null,
  });
  if (error || !data) return { outcome: "failed" };
  const r = data as { outcome: string; forgiven_cents?: number; written_off_cents?: number; orderIds?: string[]; sessions?: string[] };
  if (r.outcome === "forgiven") {
    await closeSessionsFor((r.sessions ?? []).map(session_id => ({ session_id })), "written_off");
    return { outcome: "forgiven", forgivenCents: Number(r.forgiven_cents ?? 0), writtenOffCents: Number(r.written_off_cents ?? 0), orderIds: r.orderIds ?? [] };
  }
  if (r.outcome === "repeat") return { outcome: "repeat", forgivenCents: Number(r.forgiven_cents ?? 0) };
  const known = ["changed", "paying", "split", "unresolved", "conflict", "invalid"] as const;
  return { outcome: (known as readonly string[]).includes(r.outcome) ? (r.outcome as (typeof known)[number]) : "failed" };
}

/** The refusal each outcome is explained with, from the floor's side. */
export const REST_REFUSAL: Record<string, string> = {
  changed: "apiErr.writeOffChanged",
  paying: "apiErr.writeOffPaying",
  split: "apiErr.writeOffSplit",
  unresolved: "apiErr.writeOffUnresolved",
  conflict: "apiErr.retryConflict",
  invalid: "apiErr.invalidRequest",
  failed: "apiErr.generic",
};

/** A locked division can lose its unpaid parts even before its first payment. */
export async function hasLockedSlotSplit(restaurantId: string, orders: { id: string; session_id?: string | null }[]): Promise<boolean | null> {
  const sessions = [...new Set(orders.map(o => o.session_id).filter((id): id is string => Boolean(id)))];
  if (!sessions.length) return false;
  const { data, error } = await createAdminClient().from("bill_splits").select("order_ids")
    .eq("restaurant_id", restaurantId).eq("model_version", 2).eq("status", "locked").in("session_id", sessions);
  if (error) return null;
  return (data ?? []).some(s => s.order_ids.some((id: string) => orders.some(o => o.id === id)));
}
