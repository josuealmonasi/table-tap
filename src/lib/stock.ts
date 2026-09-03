import type { OrderLineItem } from "@/lib/types";

/**
 * How much of each dish an order actually eats.
 *
 * Pure, because getting this wrong is how a restaurant ends up selling food it
 * does not have, and the only way to test it cheaply is without a database.
 *
 * Three things consume stock and they are easy to miss:
 *
 *  - A plain line takes its own quantity.
 *  - A combo takes each component's quantity, multiplied by how many of the
 *    combo were ordered — two "burger + fries" deals is two burgers.
 *  - An extra is its own menu item, and one is added per unit of the line it
 *    hangs off: a coffee with oat milk, ordered three times, is three oat milks.
 *
 * A combo's per-component extras are copied onto the line's own `extras` by the
 * cart, so counting `line.extras` covers both and counting the components'
 * extras as well would double them.
 */
export interface StockDemand {
  itemId: string;
  qty: number;
}

/**
 * One entry per dish, summed.
 *
 * Summing matters: the same dish can appear on several lines (one with onions,
 * one without), and `reserve_stock` joins on the item id, so two rows for one
 * dish would be counted once and oversell it.
 */
export function stockDemand(lines: OrderLineItem[]): StockDemand[] {
  const totals = new Map<string, number>();
  const add = (itemId: string, qty: number) => {
    if (qty > 0) totals.set(itemId, (totals.get(itemId) ?? 0) + qty);
  };

  for (const line of lines) {
    const lineQty = Math.max(0, Math.floor(line.qty));
    if (line.comboId) {
      for (const component of line.components ?? []) {
        add(component.itemId, Math.max(0, Math.floor(component.qty)) * lineQty);
      }
    } else {
      add(line.itemId, lineQty);
    }
    for (const extra of line.extras ?? []) add(extra.id, lineQty);
  }

  return [...totals].map(([itemId, qty]) => ({ itemId, qty }));
}

/** A dish the kitchen cannot fill, and how many it can. */
export interface StockShortfall {
  itemId: string;
  name: string;
  available: number;
}

/** A dish this order pushed to (or below) the restaurant's warning level. */
export interface StockWarning {
  itemId: string;
  name: string;
  stock: number;
  kind: "low_stock" | "out_of_stock";
}

/** What `reserve_stock` answers. */
export interface ReserveResult {
  ok: boolean;
  short: StockShortfall[];
  low: StockWarning[];
}

/** The shape the SQL function wants: snake_case, and only what it reads. */
export function toDemandPayload(demand: StockDemand[]): { item_id: string; qty: number }[] {
  return demand.map(d => ({ item_id: d.itemId, qty: d.qty }));
}

/**
 * Reads the function's answer back into our own shape.
 *
 * Defensive about missing fields: a reservation that came back unreadable must
 * not look like a successful one, so anything unrecognised is treated as a
 * refusal rather than as permission to sell.
 */
export function parseReserveResult(raw: unknown): ReserveResult {
  const row = (raw ?? {}) as {
    ok?: boolean;
    short?: { item_id: string; name: string; available: number }[];
    low?: { item_id: string; name: string; stock: number; kind: string }[];
  };
  return {
    ok: row.ok === true,
    short: (row.short ?? []).map(s => ({
      itemId: s.item_id,
      name: s.name,
      available: Number(s.available) || 0,
    })),
    low: (row.low ?? []).map(l => ({
      itemId: l.item_id,
      name: l.name,
      stock: Number(l.stock) || 0,
      kind: l.kind === "out_of_stock" ? "out_of_stock" : "low_stock",
    })),
  };
}
