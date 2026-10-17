import type { OrderLineItem } from "@/lib/types";

/**
 * Sales the till rang without a connection, kept on this device until they
 * are sent.
 *
 * This is the one place a sale exists before the server knows about it, so
 * losing it loses the record of money that is already in the drawer. It is
 * kept under one key for every restaurant on the device, so signing out can
 * see whether anything is still waiting. A browser that will not store it
 * cannot hold a sale, and the till says so instead of pretending.
 */

const KEY = "tt-offline-sales";

export interface HeldSale {
  /** The till's reference, which becomes the sale's id: sent twice, rung once. */
  posRef: string;
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
  /** What the till charged, from its own copy of the menu. */
  charge: { subtotal: number; serviceFee: number; tip: number; discount: number; total: number };
  /** The server's last refusal, in words; absent until one comes back. */
  error?: string;
  /** Keep a contradictory ticket for the manager; retrying cannot erase the evidence. */
  acknowledgement?: { orderId: string | null; total: number | null };
}

export function readHeld(): HeldSale[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((s): s is HeldSale => typeof s === "object" && s !== null && typeof (s as HeldSale).posRef === "string")
      : [];
  } catch {
    return [];
  }
}

function write(sales: HeldSale[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(sales));
    return true;
  } catch {
    return false;
  }
}

/** Keeps a sale; false when the browser would not store it. */
export function holdSale(sale: HeldSale): boolean {
  const held = readHeld();
  if (held.some(s => s.posRef === sale.posRef && s.restaurantId === sale.restaurantId)) return true;
  if (!write([...held, sale])) return false;
  // Read back: a storage that accepts the write and keeps nothing is no storage.
  return readHeld().some(s => s.posRef === sale.posRef && s.restaurantId === sale.restaurantId);
}

/** The server has it: it is no longer this device's to keep. */
export function dropHeld(posRef: string, restaurantId: string): boolean {
  return write(readHeld().filter(s => s.posRef !== posRef || s.restaurantId !== restaurantId));
}

export function markHeldError(posRef: string, restaurantId: string, error: string): void {
  write(readHeld().map(s => (s.posRef === posRef && s.restaurantId === restaurantId ? { ...s, error } : s)));
}

/** What the server is sent for a held sale. */
export function replayBody(sale: HeldSale): Record<string, unknown> {
  return {
    posRef: sale.posRef, restaurantId: sale.restaurantId, items: sale.items, method: sale.method,
    tipPct: sale.tipPct, tipAmount: sale.tipAmount, customerName: sale.customerName, note: sale.note,
    terminalRef: sale.terminalRef, noReceipt: true,
    offline: { at: sale.at, ...sale.charge },
  };
}

/** HTTP success alone does not prove the money was recorded for this sale. */
export function saleAcknowledgement(sale: HeldSale, raw: unknown): "settled" | "unsettled" | "mismatch" {
  if (!raw || typeof raw !== "object") return "unsettled";
  const ack = raw as { settled?: unknown; orderId?: unknown; total?: unknown; onAccount?: unknown };
  if (ack.settled !== true) return "unsettled";
  if (ack.orderId !== sale.posRef || typeof ack.total !== "number" || !Number.isFinite(ack.total)
      || Math.abs(ack.total - sale.charge.total) > 0.005 || ack.onAccount) return "mismatch";
  return "settled";
}

export function keepAcknowledgement(sale: HeldSale, raw: unknown): void {
  const ack = (raw ?? {}) as { orderId?: unknown; total?: unknown };
  const acknowledgement = {
    orderId: typeof ack.orderId === "string" ? ack.orderId : null,
    total: typeof ack.total === "number" && Number.isFinite(ack.total) ? ack.total : null,
  };
  write(readHeld().map(s => s.posRef === sale.posRef && s.restaurantId === sale.restaurantId
    ? { ...s, acknowledgement: s.acknowledgement ?? acknowledgement } : s));
}
