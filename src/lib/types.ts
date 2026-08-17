import type { MenuSchedule } from "@/lib/menu-schedule";
// Shared types matching the database schema.

export type Modifier = {
  label: string;
  type: "single" | "multi";
  options: string[];
  /**
   * The customer must pick before the item can be added. Optional so every
   * modifier already stored without the field keeps working — absent reads as
   * false, which is how they behaved before this existed.
   */
  required?: boolean;
};

export type MenuItem = {
  id: string;
  restaurant_id: string;
  menu_id: string | null;
  category_id: string | null;
  name: string;
  description: string | null;
  price: number;
  emoji: string;
  image_url: string | null;
  popular: boolean;
  available: boolean;
  is_addon: boolean;
  modifiers: Modifier[];
  /** Dietary / allergen tag keys (see src/lib/dietary.ts). */
  dietary: string[];
  /** % off the base price (0 = full price). Extras are never discounted. */
  discount_pct: number;
  sort_order: number;
};

// Links a product to an add-on item it offers (both rows live in menu_items).
export type ItemAddon = {
  product_id: string;
  addon_id: string;
  sort_order: number;
};

export type Category = {
  id: string;
  restaurant_id: string;
  menu_id: string | null;
  name: string;
  sort_order: number;
};

/** A named menu (e.g. "Breakfast", "Dinner"). Each owns its own categories,
 *  products and extras. `active` controls whether customers see it. */
export type Menu = {
  id: string;
  restaurant_id: string;
  name: string;
  active: boolean;
  sort_order: number;
  /** Optional opening hours; null means the switch decides. */
  schedule?: MenuSchedule | null;
};

export type Restaurant = {
  id: string;
  name: string;
  tagline: string | null;
  /** Emoji standing in for the restaurant. Optional — null means show none. */
  logo: string | null;
  /** Uploaded mark. Takes precedence over the emoji when present. */
  logo_url?: string | null;
  currency: string;
  service_pct: number;
  service_enabled: boolean;
  accepting_orders: boolean;
  /** IVA %, already included in menu prices (0 = no tax shown). */
  tax_pct: number;
  /** Show the net + IVA split to customers, or just the total. */
  tax_show_breakdown: boolean;
  /** IANA zone the menu schedules are evaluated in. Only the dashboard reads
   *  it — the customer payload stays as narrow as it was. */
  timezone?: string;
  /** Cover photo above the menu header. Null until one is uploaded. */
  cover_url?: string | null;
  /** Whether to show it. Off by default, so nothing changes until asked. */
  cover_enabled?: boolean;
  /** Dine-in tables may order first and settle at the end. Off by default. */
  allow_pay_later?: boolean;
};

export type RestaurantTable = {
  id: string;
  restaurant_id: string;
  label: string;
};

export type OrderStatus =
  "pending_payment" | "received" | "preparing" | "ready" | "completed" | "cancelled";

// A chosen extra (add-on item) snapshot on a line item.
export type OrderExtra = {
  id: string;
  name: string;
  emoji: string;
  price: number;
};

// A single line item snapshot stored on the order.
/** One item inside a combo, kept on the line so the kitchen ticket lists it. */
export type ComboComponent = {
  itemId: string;
  name: string;
  emoji: string;
  qty: number;
  /**
   * Choices made for this component of the bundle. A combo is several dishes
   * sold as one line, so "no onions" has to attach to the burger rather than
   * to the deal — the kitchen needs to know which plate it applies to.
   */
  mods?: Record<string, string | string[]>;
  /**
   * Paid additions for this component. These are charged on top of the bundle
   * price: the deal fixes what the dishes cost, not what an oat-milk upgrade
   * costs. They are also copied onto the cart line's own `extras`, which is
   * what the pricing engine actually sums.
   */
  extras?: OrderExtra[];
};

export type OrderLineItem = {
  itemId: string;
  name: string;
  emoji: string;
  price: number; // base unit price (before extras)
  qty: number;
  mods: Record<string, string | string[]>;
  extras?: OrderExtra[];
  notes?: string;
  /** % off the base price at the time of ordering (0/absent = full price). */
  discountPct?: number;
  /** Set when this line is a combo package; `price` is then the combo price. */
  comboId?: string;
  components?: ComboComponent[];
  /**
   * What a combo's components would cost separately. Display only — it lets
   * the cart strike the regular price the way the menu card does. Money is
   * always re-derived server-side from `price`, never from this.
   */
  comboRegular?: number;
};

/** Unit price including selected extras (before quantity). */
export function lineUnitPrice(item: { price: number; extras?: OrderExtra[] }): number {
  return item.price + (item.extras?.reduce((sum, e) => sum + e.price, 0) ?? 0);
}

export type Order = {
  id: string;
  restaurant_id: string;
  table_id: string | null;
  table_label: string | null;
  status: OrderStatus;
  subtotal: number;
  service_fee: number;
  tip: number;
  tax_pct: number;
  total: number;
  currency: string;
  items: OrderLineItem[];
  note: string | null;
  pay_method: string | null;
  paid: boolean;
  /** Served but never paid for; out of revenue, and no longer owed. */
  written_off?: boolean;
  /** The coupon this order was priced with, if any — it can't take another. */
  coupon_code?: string | null;
  /** What came off this order, whether at checkout or from the floor later. */
  discount?: number | null;
  stripe_payment_intent: string | null;
  stripe_refund_id: string | null;
  created_at: string;
};

// A customer's tap of "call waiter" / "request bill" from a table QR.
export type ServiceRequest = {
  id: string;
  restaurant_id: string;
  table_id: string | null;
  table_label: string;
  /** 'pay' means the table wants to settle in person. */
  kind: "waiter" | "bill" | "pay";
  status: "open" | "done";
  created_at: string;
};

// Short display code derived from a UUID, e.g. "ORD-3F9A".
export function orderCode(id: string): string {
  return "ORD-" + id.replace(/-/g, "").slice(0, 4).toUpperCase();
}
