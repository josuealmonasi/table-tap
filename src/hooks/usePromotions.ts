"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/context";
import { fetchPromotions } from "@/lib/promotions-data";
import type { PromotionKind, PromotionWithItems } from "@/lib/promotions";
import type { Category, MenuItem } from "@/lib/types";

/** What the editor sends when creating or updating a promotion. */
export interface PromotionInput {
  kind: PromotionKind;
  name: string;
  emoji: string;
  /** Optional blurb shown under the deal on the customer menu. */
  description?: string | null;
  comboPrice?: number | null;
  buyQty?: number | null;
  payQty?: number | null;
  tiers?: { qty: number; price: number }[] | null;
  /** Items the promotion covers; `qty` is how many a combo includes. */
  items: { itemId: string; qty: number }[];
}

/**
 * Loads and edits the restaurant's promotions, plus the products they can be
 * built from. Writes go through /api/promotions, which re-checks the role.
 */
export function usePromotions(restaurantId: string) {
  const t = useT();
  const [promotions, setPromotions] = useState<PromotionWithItems[]>([]);
  const [products, setProducts] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  // Which menus customers can currently see — a combo whose component lives on
  // a hidden menu never renders, and the panel has to be able to say so.
  const [activeMenuIds, setActiveMenuIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const [promos, { data: items }, { data: cats }, { data: menus }] = await Promise.all([
      fetchPromotions(supabase, restaurantId),
      supabase
        .from("menu_items")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .eq("is_addon", false)
        .order("name"),
      // Needed so the product picker can be searched by category too.
      supabase
        .from("categories")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("sort_order"),
      supabase
        .from("menus")
        .select("id, active")
        .eq("restaurant_id", restaurantId)
        .eq("active", true),
    ]);
    setPromotions(promos);
    setProducts((items as MenuItem[] | null) ?? []);
    setCategories((cats as Category[] | null) ?? []);
    setActiveMenuIds(new Set(((menus as { id: string }[] | null) ?? []).map(m => m.id)));
    setLoading(false);
  }, [restaurantId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const send = useCallback(
    async (
      method: "POST" | "PATCH" | "DELETE",
      body: unknown,
    ): Promise<string | null> => {
      const res = await fetch("/api/promotions", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return data.error ?? t("apiErr.generic");
      await reload();
      return null;
    },
    [reload],
  );

  return {
    promotions,
    products,
    categories,
    activeMenuIds,
    loading,
    create: (input: PromotionInput) => send("POST", input),
    update: (id: string, input: PromotionInput) => send("PATCH", { id, ...input }),
    setActive: (id: string, active: boolean) => send("PATCH", { id, active }),
    remove: (id: string) => send("DELETE", { id }),
  };
}
