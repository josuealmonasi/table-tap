// Shared types matching the database schema.

export type Modifier = {
  label: string;
  type: "single" | "multi";
  options: string[];
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
};

export type Restaurant = {
  id: string;
  name: string;
  tagline: string | null;
  logo: string;
  currency: string;
  service_pct: number;
};

export type RestaurantTable = {
  id: string;
  restaurant_id: string;
  label: string;
};

export type OrderStatus =
  | "pending_payment"
  | "received"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled";

// A chosen extra (add-on item) snapshot on a line item.
export type OrderExtra = {
  id: string;
  name: string;
  emoji: string;
  price: number;
};

// A single line item snapshot stored on the order.
export type OrderLineItem = {
  itemId: string;
  name: string;
  emoji: string;
  price: number; // base unit price (before extras)
  qty: number;
  mods: Record<string, string | string[]>;
  extras?: OrderExtra[];
  notes?: string;
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
  total: number;
  currency: string;
  items: OrderLineItem[];
  note: string | null;
  pay_method: string | null;
  paid: boolean;
  created_at: string;
};

// Short display code derived from a UUID, e.g. "ORD-3F9A".
export function orderCode(id: string): string {
  return "ORD-" + id.replace(/-/g, "").slice(0, 4).toUpperCase();
}
