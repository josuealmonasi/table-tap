export const HELD_DISPOSITIONS = ["retained_cash", "returned_cash", "duplicate", "no_cash"] as const;
export type HeldDisposition = typeof HELD_DISPOSITIONS[number];

export interface HeldResolutionDetails {
  disposition: HeldDisposition;
  reason: string;
  collector: string;
  amount: number;
  currency: "MXN" | "USD";
  collectedAt: string;
  paymentId?: string;
  cashReceiptId?: string;
  payoutId?: string;
}

export interface HeldResolutionBody extends HeldResolutionDetails { restaurantId: string; posRef: string }
export interface HeldResolution {
  cash_receipt_id?: string | null;
  payment_id?: string | null;
  payout_id?: string | null;
  disposition: HeldDisposition;
  reason: string;
  resolved_by: string;
  resolved_at: string;
  amount: number;
  currency: string;
}

const uuid = (v: unknown): boolean => typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
const fields = new Set(["restaurantId", "posRef", "disposition", "reason", "collector", "amount", "currency", "collectedAt", "paymentId", "cashReceiptId", "payoutId"]);

function isoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  // Date.parse normalizes February 30 into March; that is not a valid ISO date.
  const day = value.slice(0, 10);
  return new Date(`${day}T00:00:00Z`).toISOString().startsWith(day);
}

export function validResolution(body: Record<string, unknown> | null): body is HeldResolutionBody & Record<string, unknown> {
  if (!body || Object.keys(body).some(k => !fields.has(k))) return false;
  const { reason, amount, collector, collectedAt } = body;
  // The database stores currency units with cent precision, like the receipt.
  return uuid(body.restaurantId) && uuid(body.posRef)
    && typeof body.disposition === "string" && HELD_DISPOSITIONS.some(d => d === body.disposition)
    && typeof reason === "string" && reason.trim().length >= 8 && reason.length <= 500
    && typeof collector === "string" && collector.trim().length > 0 && collector.length <= 254
    && typeof amount === "number" && Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000
    && Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-7
    && (body.currency === "MXN" || body.currency === "USD")
    && isoTimestamp(collectedAt)
    && ["paymentId", "cashReceiptId", "payoutId"].every(k => body[k] === undefined || uuid(body[k]));
}

/** SQL decides under the money lock; do not turn its refusals into a generic failure. */
export const RESOLUTION_ERRORS: Record<string, [string, number]> = {
  "manager required": ["heldResolveManager", 403],
  "invalid resolution": ["heldResolveInvalid", 400],
  "held cash receipt required": ["heldResolveCashRequired", 400],
  "receipt already resolved": ["heldResolveResolved", 409],
  "receipt already decided": ["heldResolveDecided", 409],
  "collected currency changed": ["heldResolveCurrency", 409],
  "collector changed": ["heldResolveCollector", 409],
  "existing accounting requires duplicate resolution": ["heldResolveExisting", 409],
  "one duplicate link required": ["heldResolveOneLink", 400],
  "matching cash payment required": ["heldResolvePayment", 400],
  "matching cash receipt required": ["heldResolveReceipt", 400],
  "open shift required": ["heldResolveOpenShift", 409],
  "matching recorded payout required": ["heldResolvePayout", 400],
  "unexpected payout": ["heldResolveUnexpectedPayout", 400],
  "foreign returned cash takes no payout": ["heldResolveForeignPayout", 400],
  "no_cash takes no amount and no links": ["heldResolveNoCash", 400],
  "unexpected receipt link": ["heldResolveUnexpectedReceipt", 400],
  "new cash receipt required": ["heldResolveNewCash", 400],
};
