"use client";

import useSWR from "swr";
import { useDashboardScope } from "@/components/layout/DashboardCache.react-component";
import { DashboardReadError, readDashboardJson } from "@/lib/dashboard-read";

export { BADGES_CHANGED, badgesChanged } from "@/lib/badge-events";

interface BadgeData {
  badges?: Record<string, number>;
  forbidden?: boolean;
}

async function readBadges(key: readonly [string, string]): Promise<BadgeData> {
  try {
    return await readDashboardJson<BadgeData>(key);
  } catch (error) {
    // A platform admin has no restaurant to count. Other failures retain the
    // last counts rather than claiming there is nothing left to do.
    if (error instanceof DashboardReadError && error.status === 403) {
      return { badges: {}, forbidden: true };
    }
    throw error;
  }
}

/** Shared reads while visible, plus immediate invalidation after an action. */
export function useBadges(): Record<string, number> {
  const scope = useDashboardScope();
  const { data } = useSWR(scope ? ["/api/badges", scope] as const : null, readBadges, {
    refreshInterval: current => current?.forbidden ? 0 : 30_000,
  });

  return data?.badges ?? {};
}
