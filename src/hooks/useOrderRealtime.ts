"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Order } from "@/lib/types";

/**
 * Subscribes to live UPDATEs for a single order row and returns the latest
 * version. Seeds from the server-rendered order so there's no loading flash.
 */
export function useOrderRealtime(initialOrder: Order): Order {
  const [order, setOrder] = useState<Order>(initialOrder);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`order-${initialOrder.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `id=eq.${initialOrder.id}`,
        },
        (payload) => setOrder(payload.new as Order)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [initialOrder.id]);

  return order;
}
