"use client";

import useSWR from "swr";
import type { DisputeHistory } from "@/lib/disputes/types";

export type DisputesByOrder = Record<string, DisputeHistory[]>;

async function fetchHistory([, , orders]: readonly [string, string, string[]]): Promise<DisputesByOrder> {
  try {
    const query = new URLSearchParams();
    orders.forEach(order => query.append("order", order));
    const response = await fetch(`/api/disputes/history?${query}`);
    if (!response.ok) throw new Error("Dispute history unavailable");
    return await response.json() as DisputesByOrder;
  } catch (cause) {
    throw new Error("Dispute history unavailable", { cause });
  }
}

/**
 * The orders on a history page a chargeback could touch: only a card payment
 * can be disputed, and an order paid all in cash says "cash". Mixed methods
 * leave it null, so those are asked about too.
 */
export function disputableOrders(orders: { id: string; pay_method: string | null }[]): string[] {
  return orders.filter(order => order.pay_method !== "cash").map(order => order.id);
}

/**
 * One chargeback read for a whole history page (review screens4). No read at
 * all when no order on it could have been disputed, as on a till that has
 * never taken a card.
 */
export function useDisputeHistory(restaurantId: string, orderIds: string[]) {
  return useSWR(orderIds.length > 0 ? ["dispute-history", restaurantId, orderIds] as const : null, fetchHistory);
}
