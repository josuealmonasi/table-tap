"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/context";

/** A coupon as the dashboard lists it. */
export interface Coupon {
  id: string;
  code: string;
  kind: "percent" | "fixed";
  value: number;
  max_uses: number | null;
  uses_count: number;
  min_subtotal: number;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  /** Applied by the floor to an open bill; hidden from the customer's box. */
  staff_only: boolean;
  created_at: string;
}

export interface CouponInput {
  code?: string;
  kind: "percent" | "fixed";
  value: number;
  maxUses: number | null;
  minSubtotal: number;
  /** ISO dates; null = no bound on that end. */
  startsAt?: string | null;
  endsAt?: string | null;
  staffOnly?: boolean;
}

/**
 * Loads and edits the restaurant's coupons. Reads go direct through RLS (only
 * owners and managers can see the table); writes go through /api/coupons,
 * which re-checks the role server-side.
 */
export function useCoupons(restaurantId: string) {
  const t = useT();
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const { data } = await createClient()
      .from("coupons")
      .select(
        "id, code, kind, value, max_uses, uses_count, min_subtotal, active, starts_at, ends_at, staff_only, created_at",
      )
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false });
    setCoupons((data as Coupon[] | null) ?? []);
    setLoading(false);
  }, [restaurantId]);

  useEffect(() => {
    reload();
  }, [reload]);

  /** Sends a write and reloads. Returns an error message, or null on success. */
  const send = useCallback(
    async (method: "POST" | "PATCH" | "DELETE", body: unknown): Promise<string | null> => {
      const res = await fetch("/api/coupons", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return data.error ?? t("apiErr.generic");
      await reload();
      return null;
    },
    [reload, t],
  );

  return {
    coupons,
    loading,
    create: (input: CouponInput) => send("POST", input),
    update: (id: string, input: CouponInput) => send("PATCH", { id, ...input }),
    setActive: (id: string, active: boolean) => send("PATCH", { id, active }),
    remove: (id: string) => send("DELETE", { id }),
  };
}
