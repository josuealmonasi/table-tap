import type { OrderLineItem } from "@/lib/types";

/**
 * Sales the till rang without a connection, kept on this device until they
 * are sent.
 *
 * This is the one place a sale exists before the server knows about it, so
 * losing it loses the record of money that is already in the drawer. Each
 * sale is its own key (`tt-offline-sale:<restaurant>:<reference>`), and every
 * change writes only that key. They were one shared list, read and rewritten
 * whole on every change: two till tabs on one tablet saving at the same moment
 * each read the list, each added their own sale and each read it back — and
 * the later write erased the earlier sale, after both had said it was safe.
 * Signing out reads every key, for every restaurant on the device, to see
 * whether anything is still waiting. A browser that will not store a sale
 * cannot hold one, and the till says so instead of pretending.
 */

const PREFIX = "tt-offline-sale:";
/**
 * The old shared list. Still read, so a sale held by a till running the code
 * from before is not lost; never rewritten except to take out a sale that has
 * been sent, and never deleted while it may still be written to.
 */
const LEGACY_KEY = "tt-offline-sales";

export interface HeldSale {
  /** The till's reference, which becomes the sale's id: sent twice, rung once. */
  posRef: string;
  /** Server-signed original collector and currency, saved with this sale. */
  collectorContext?: string;
  collector?: string;
  restaurantId: string;
  /** When it happened. */
  at: string;
  method: "cash" | "card";
  items: OrderLineItem[];
  tipPct?: number;
  tipAmount?: number;
  customerName?: string;
  note?: string;
  terminalRef?: string;
  /**
   * The currency it was charged in. Absent on a sale held by a till from
   * before this was recorded.
   */
  currency?: string;
  /** What the till charged, from its own copy of the menu. */
  charge: { subtotal: number; serviceFee: number; tip: number; discount: number; total: number };
  /** The server's last refusal, in words; absent until one comes back. */
  error?: string;
  /** Keep a contradictory ticket for the manager; retrying cannot erase the evidence. */
  acknowledgement?: { orderId: string | null; total: number | null };
}

const keyOf = (restaurantId: string, posRef: string): string => `${PREFIX}${restaurantId}:${posRef}`;

function isSale(value: unknown): value is HeldSale {
  return typeof value === "object" && value !== null
    && typeof (value as HeldSale).posRef === "string" && typeof (value as HeldSale).restaurantId === "string";
}

function parse(raw: string | null): unknown {
  try {
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function legacy(): HeldSale[] {
  const parsed = parse(localStorage.getItem(LEGACY_KEY));
  return Array.isArray(parsed) ? parsed.filter(isSale) : [];
}

/** Every held sale on this device: each key, then the old list's leftovers. */
export function readHeld(): HeldSale[] {
  try {
    const held = new Map<string, HeldSale>();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const sale = parse(localStorage.getItem(key));
      if (isSale(sale)) held.set(keyOf(sale.restaurantId, sale.posRef), sale);
    }
    for (const sale of legacy()) {
      if (!held.has(keyOf(sale.restaurantId, sale.posRef))) held.set(keyOf(sale.restaurantId, sale.posRef), sale);
    }
    return [...held.values()];
  } catch {
    return [];
  }
}

function heldOne(posRef: string, restaurantId: string): HeldSale | null {
  return readHeld().find(s => s.posRef === posRef && s.restaurantId === restaurantId) ?? null;
}

/** Writes this one sale's key and nothing else. */
function put(sale: HeldSale): boolean {
  try {
    localStorage.setItem(keyOf(sale.restaurantId, sale.posRef), JSON.stringify(sale));
    return true;
  } catch {
    return false;
  }
}

/** Keeps a sale; false when the browser would not store it. */
export function holdSale(sale: HeldSale): boolean {
  if (heldOne(sale.posRef, sale.restaurantId)) return true;
  if (!put(sale)) return false;
  // Read back: a storage that accepts the write and keeps nothing is no storage.
  return heldOne(sale.posRef, sale.restaurantId) !== null;
}

/** The server has it: it is no longer this device's to keep. */
export function dropHeld(posRef: string, restaurantId: string): boolean {
  try {
    localStorage.removeItem(keyOf(restaurantId, posRef));
    const old = legacy();
    const rest = old.filter(s => s.posRef !== posRef || s.restaurantId !== restaurantId);
    if (rest.length !== old.length) {
      if (rest.length === 0) localStorage.removeItem(LEGACY_KEY);
      else localStorage.setItem(LEGACY_KEY, JSON.stringify(rest));
    }
    return true;
  } catch {
    return false;
  }
}

export function markHeldError(posRef: string, restaurantId: string, error: string): void {
  const sale = heldOne(posRef, restaurantId);
  if (sale) put({ ...sale, error });
}

/** What the server is sent for a held sale. */
export function replayBody(sale: HeldSale): Record<string, unknown> {
  return {
    posRef: sale.posRef, restaurantId: sale.restaurantId, items: sale.items, method: sale.method,
    tipPct: sale.tipPct, tipAmount: sale.tipAmount, customerName: sale.customerName, note: sale.note,
    terminalRef: sale.terminalRef, currency: sale.currency, collectorContext: sale.collectorContext, noReceipt: true,
    offline: { at: sale.at, ...sale.charge },
  };
}

/** HTTP success alone does not prove the money was recorded for this sale. */
export function saleAcknowledgement(sale: HeldSale, raw: unknown): "settled" | "unsettled" | "mismatch" {
  if (!raw || typeof raw !== "object") return "unsettled";
  const ack = raw as { settled?: unknown; orderId?: unknown; total?: unknown; onAccount?: unknown; currency?: unknown; method?: unknown };
  if (ack.settled !== true) return "unsettled";
  // The server replays what was collected, including after a later return.
  // Accepting the retained bill instead would hide a contradictory collection.
  if (ack.orderId !== sale.posRef || typeof ack.total !== "number" || !Number.isFinite(ack.total)
      || Math.abs(ack.total - sale.charge.total) > 0.005 || ack.onAccount
      || (sale.currency !== undefined && ack.currency !== sale.currency) || ack.method !== sale.method) return "mismatch";
  return "settled";
}

export function keepAcknowledgement(sale: HeldSale, raw: unknown): void {
  const ack = (raw ?? {}) as { orderId?: unknown; total?: unknown };
  const acknowledgement = {
    orderId: typeof ack.orderId === "string" ? ack.orderId : null,
    total: typeof ack.total === "number" && Number.isFinite(ack.total) ? ack.total : null,
  };
  const held = heldOne(sale.posRef, sale.restaurantId);
  if (held) put({ ...held, acknowledgement: held.acknowledgement ?? acknowledgement });
}
