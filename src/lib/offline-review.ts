import type { HeldSale } from "@/lib/offline-sales";
import type { PosSaleBody } from "@/lib/pos-sale";

export interface QueuedOfflineSale {
  pos_ref: string;
  body: PosSaleBody & { offline: HeldSale["charge"] & { at: string } };
  collector: string | null;
  currency: string | null;
  submitted_by: string;
  reason: string;
  approved_by: string | null;
  approved_at: string | null;
}

export function reviewSale(row: QueuedOfflineSale, restaurantId: string): HeldSale {
  const { at, ...charge } = row.body.offline;
  return { ...row.body, posRef: row.pos_ref, restaurantId, method: row.body.method as HeldSale["method"],
    items: row.body.items ?? [], at, charge, error: row.reason, collector: row.collector ?? undefined,
    collectorContext: row.collector ? "verified-on-server" : undefined, currency: row.currency ?? undefined };
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
