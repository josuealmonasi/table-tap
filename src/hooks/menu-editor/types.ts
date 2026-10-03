import type { Dispatch, SetStateAction } from "react";
import type { createClient } from "@/lib/supabase/client";
import type { Category, Menu, MenuItem, Modifier } from "@/lib/types";
import type { useToast } from "@/components/ui/Toast";
import type { Writer } from "./writer";

/** Editable fields for a product (a non-add-on menu item). */
export interface ProductInput {
  name: string;
  description: string;
  price: number;
  image_url: string | null;
  emoji: string;
  popular: boolean;
  /** Option groups the customer picks from (e.g. "Spice level"). */
  modifiers: Modifier[];
  /** Dietary / allergen tag keys (see src/lib/dietary.ts). */
  dietary: string[];
  /** % off the base price (0 = full price). */
  discount_pct: number;
  /** Needs no preparation — stays off the kitchen ticket. */
  skips_kitchen: boolean;
  /**
   * How many are left, or null when the restaurant is not counting this dish.
   * Null is the default: `available` stays the manual switch it always was.
   */
  stock: number | null;
}

/** Editable fields for an add-on item. */
export interface AddonInput {
  name: string;
  price: number;
  emoji: string;
}

/** What every group of editor actions works from: the client, the state and the writer. */
export interface EditorContext {
  supabase: ReturnType<typeof createClient>;
  restaurantId: string;
  toast: ReturnType<typeof useToast>;
  t: (key: string, vars?: Record<string, string | number>) => string;
  menus: Menu[];
  sections: Category[];
  products: MenuItem[];
  addons: MenuItem[];
  /** product_id → addon_id[] */
  links: Record<string, string[]>;
  setMenus: Dispatch<SetStateAction<Menu[]>>;
  setProducts: Dispatch<SetStateAction<MenuItem[]>>;
  setAddons: Dispatch<SetStateAction<MenuItem[]>>;
  reload: () => Promise<void>;
  w: Writer;
}
