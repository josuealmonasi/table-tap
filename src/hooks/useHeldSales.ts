"use client";

import useSWR from "swr";
import type { QueuedOfflineSale } from "@/lib/offline-review";
import { readDashboardJson } from "@/lib/dashboard-read";

interface HeldPage { sales: QueuedOfflineSale[]; hasMore?: boolean }

/** A failed read keeps SWR's last good list, like every other dashboard read. */
async function readSales([, restaurantId, view, page]: [string, string, string, number]): Promise<HeldPage> {
  const url = view === "history" ? `/api/pos/recover?view=history&page=${page}` : "/api/pos/recover";
  return readDashboardJson<HeldPage>([url, restaurantId]);
}

/** Pending refreshes keep the badge live; approved history reads one page on demand. */
export function useHeldSales(restaurantId: string, history: boolean, page: number) {
  const pending = useSWR(["held-sales", restaurantId, "pending", 0], readSales, { refreshInterval: 30_000 });
  const approved = useSWR(history ? ["held-sales", restaurantId, "history", page] : null, readSales, {
    refreshInterval: 0, revalidateOnFocus: false, revalidateOnReconnect: false,
  });
  const shown = history ? approved : pending;
  return {
    rows: (shown.data?.sales ?? []).filter(row => history ? Boolean(row.approved_at) : !row.approved_at),
    pendingCount: pending.data?.sales.filter(row => !row.approved_at).length,
    loading: shown.isLoading,
    error: Boolean(shown.error),
    hasMore: approved.data?.hasMore === true,
    reload: () => shown.mutate(),
    refreshPending: () => pending.mutate(),
  };
}
