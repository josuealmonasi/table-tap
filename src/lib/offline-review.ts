import type { HeldSale } from "@/lib/offline-sales";
import type { PosSaleBody } from "@/lib/pos-sale";
import { offlineLines, type OfflineCharge } from "@/lib/offline-sale";
import { cashAmount } from "@/lib/cash-drawer";
import { round2 } from "@/lib/money";
import type { HeldResolution } from "@/lib/held-resolution";

export interface QueuedOfflineSale {
  pos_ref: string;
  body: PosSaleBody & { offline: HeldSale["charge"] & { at: string } };
  collector: string | null;
  currency: string | null;
  submitted_by: string;
  reason: string;
  approved_by: string | null;
  approved_at: string | null;
  resolved_at?: string | null;
  resolution?: HeldResolution | null;
}

export function reviewSale(row: QueuedOfflineSale, restaurantId: string): HeldSale {
  const { at } = row.body.offline;
  return { ...row.body, posRef: row.pos_ref, restaurantId, method: row.body.method as HeldSale["method"],
    items: offlineLines(row.body.items), at, charge: reviewCharge(row.body.offline), error: row.reason, collector: row.collector ?? undefined,
    collectorContext: row.collector ? "verified-on-server" : undefined, currency: row.currency ?? undefined };
}

/** Display legacy receipts, including invalid clocks and old numeric strings.
 * This projection never authorizes settlement or changes the raw receipt. */
export function reviewCharge(raw: unknown): Omit<OfflineCharge, "at"> {
  const r = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const money = (key: string) => cashAmount(typeof r[key] === "number" ? round2(r[key]) : r[key], false) ?? 0;
  return { subtotal: money("subtotal"), serviceFee: money("serviceFee"), tip: money("tip"),
    discount: money("discount"), total: money("total"),
    ...(typeof r.taxPct === "number" && Number.isFinite(r.taxPct) && r.taxPct >= 0 && r.taxPct <= 100 ? { taxPct: r.taxPct } : {}) };
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) => v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b))) : v);
}

/** An HTTP success or a matching amount cannot prove every line was received. */
export function queueAcknowledgement(body: Record<string, unknown>, raw: unknown): boolean {
  const ack = raw as { queued?: unknown; orderId?: unknown; receipt?: unknown } | null;
  return ack?.queued === true && ack.orderId === body.posRef && canonical(ack.receipt) === canonical(body);
}
