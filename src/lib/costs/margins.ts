import { recipeChoicesOffered } from "./recipe-choices";
import type { Modifier } from "@/lib/types";
import { lineRevenues, type RevenueOrder } from "@/lib/report-revenue";
import { itemSalePrice } from "@/lib/pricing";
import { defaultChoices, dishCost, type RecipeBook, type UnitCosts } from "./recipe-cost";

/**
 * What a product leaves, and what a period's sales left.
 *
 * A margin here is a CONTRIBUTION margin: the price without IVA (which was
 * never the restaurant's), less what went into it and what taking the money
 * cost. Rent, wages and electricity are not in it — it is what each sale
 * leaves to pay them with, and never the business's profit.
 *
 * Pure.
 */

export interface CostedItem {
  id: string;
  name: string;
  emoji: string | null;
  price: number;
  discount_pct: number;
  modifiers: Modifier[];
  is_addon: boolean;
}

export interface UnitMargin {
  itemId: string;
  name: string;
  emoji: string | null;
  isAddon: boolean;
  /** What a diner pays, IVA included. */
  price: number;
  /** The same without IVA. */
  net: number;
  /** Null when the product has no recipe. */
  cost: number | null;
  fee: number;
  margin: number | null;
  /** Of the price without IVA; null without a recipe or a price. */
  marginPct: number | null;
}

const withoutIva = (gross: number, taxPct: number) => (taxPct > 0 ? gross / (1 + taxPct / 100) : gross);

/** One unit of each product, costed with its default choices. */
export function unitMargin(item: CostedItem, book: RecipeBook, costs: UnitCosts, feeRate: number, taxPct: number): UnitMargin {
  const price = itemSalePrice(Number(item.price), item.discount_pct);
  const net = withoutIva(price, taxPct);
  const fee = price * feeRate;
  const cost = recipeChoicesOffered(book.get(item.id) ?? [], item.modifiers)
    ? dishCost(item.id, defaultChoices(item.modifiers), book, costs) : null;
  const margin = cost === null ? null : net - cost - fee;
  return {
    itemId: item.id, name: item.name, emoji: item.emoji, isAddon: item.is_addon,
    price, net, cost, fee, margin,
    marginPct: margin === null || net <= 0 ? null : margin / net,
  };
}

/** The products' unit margins, the thinnest first and those with no recipe last. */
export function unitMargins(items: CostedItem[], book: RecipeBook, costs: UnitCosts, feeRate: number, taxPct: number): UnitMargin[] {
  const rows = items.map(i => unitMargin(i, book, costs, feeRate, taxPct));
  const rank = (r: UnitMargin) => (r.marginPct === null ? Number.POSITIVE_INFINITY : r.marginPct);
  return rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** An order as the period reads it. */
export interface SoldOrder extends RevenueOrder {
  // What the lines actually came to after every discount is total less service and tip.
  tax_pct: number;
  /** Frozen ingredient cost for each whole sold line; absent or null is unknown. */
  ingredient_costs?: (number | null)[];
}

export interface Contribution {
  /** The product, or `combo:<id>` for a combo. */
  key: string;
  name: string;
  emoji: string | null;
  units: number;
  /** Without IVA, after discounts. */
  revenue: number;
  cost: number;
  fees: number;
  contribution: number;
  /** Every unit sold has a saved ingredient valuation. */
  complete: boolean;
}

export interface PeriodContribution {
  rows: Contribution[];
  /**
   * The totals cover only lines whose ingredient valuation was saved. A
   * line whose cost is unknown would count as costing nothing, and a
   * period that is mostly uncosted would show a margin of nearly everything.
   */
  revenue: number;
  cost: number;
  fees: number;
  contribution: number;
  /** Revenue from lines left out because their saved ingredient cost is unknown. */
  uncosted: number;
}

/**
 * What the period's sales left, product by product.
 *
 * An order's own discounts — a promotion, a coupon — are shared across its
 * lines by value, since they were taken off the order as a whole.
 */
export function periodContribution(orders: SoldOrder[], feeRate: number): PeriodContribution {
  const byKey = new Map<string, Contribution>();
  const total = { revenue: 0, cost: 0, fees: 0, uncosted: 0 };
  for (const order of orders) {
    const lines = Array.isArray(order.items) ? order.items : [];
    const revenues = lineRevenues(order);
    lines.forEach((line, i) => {
      const gross = revenues[i];
      const revenue = withoutIva(gross, Number(order.tax_pct) || 0);
      const fees = gross * feeRate;
      // Today's recipe and supplier price cannot tell us what yesterday used.
      const saved = order.ingredient_costs?.[i];
      const complete = typeof saved === "number" && Number.isFinite(saved) && saved >= 0;
      const cost = complete ? saved : 0;
      const key = line.comboId ? `combo:${line.comboId}` : line.itemId;
      const row = byKey.get(key) ?? {
        key, name: line.name, emoji: line.emoji ?? null, units: 0, revenue: 0, cost: 0, fees: 0, contribution: 0, complete: true,
      };
      row.units += line.qty;
      row.revenue += revenue;
      row.cost += cost;
      row.fees += fees;
      row.contribution = row.revenue - row.cost - row.fees;
      row.complete &&= complete;
      byKey.set(key, row);
      if (complete) {
        total.revenue += revenue;
        total.cost += cost;
        total.fees += fees;
      } else {
        total.uncosted += revenue;
      }
    });
  }
  const rows = [...byKey.values()].sort((a, b) => b.contribution - a.contribution);
  return { rows, ...total, contribution: total.revenue - total.cost - total.fees };
}
