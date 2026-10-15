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
  if (held.some(s => s.posRef === sale.posRef)) return true;
  if (!write([...held, sale])) return false;
  // Read back: a storage that accepts the write and keeps nothing is no storage.
  return readHeld().some(s => s.posRef === sale.posRef);
}

/** The server has it: it is no longer this device's to keep. */
export function dropHeld(posRef: string): void {
  write(readHeld().filter(s => s.posRef !== posRef));
}

export function markHeldError(posRef: string, error: string): void {
  write(readHeld().map(s => (s.posRef === posRef ? { ...s, error } : s)));
}

/** What the server is sent for a held sale. */
export function replayBody(sale: HeldSale): Record<string, unknown> {
  return {
    posRef: sale.posRef, items: sale.items, method: sale.method,
    tipPct: sale.tipPct, tipAmount: sale.tipAmount, customerName: sale.customerName, note: sale.note,
    terminalRef: sale.terminalRef, noReceipt: true,
    offline: { at: sale.at, ...sale.charge },
  };
}
