"use client";

import useSWR from "swr";
import type { QueuedOfflineSale } from "@/lib/offline-review";
import { readDashboardJson } from "@/lib/dashboard-read";

interface HeldPage { restaurantId?: string; sales: QueuedOfflineSale[]; hasMore?: boolean }

/** A failed read keeps SWR's last good list, like every other dashboard read. */
async function readSales([, restaurantId, view, page]: [string, string, string, number]): Promise<HeldPage> {
  const url = view === "history" ? `/api/pos/recover?view=history&page=${page}` : "/api/pos/recover";
  const page_ = await readDashboardJson<HeldPage>([url, restaurantId]);
  // The page's content sits outside the session-scoped cache, so a tab left
  // open across a sign-in to another restaurant could cache that restaurant's
  // sales under this one's key (Codex's review of #562). A reply for any other
  // restaurant is refused: the last good list stays, with the error shown.
  if (page_.restaurantId !== restaurantId) throw new Error("Held sales answered for another restaurant");
  return page_;
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
