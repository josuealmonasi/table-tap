"use client";

import { useEffect, useState } from "react";
import type { Station } from "@/lib/stations";

/**
 * Which station this screen is: the bar's tablet shows the bar, the pass
 * shows the kitchen, the manager's laptop shows everything. Remembered per
 * device — it is a fact about where the screen is mounted, not about who is
 * signed in.
 */
export function useBoardStation(restaurantId: string, hasStations: boolean): [Station | null, (s: Station | null) => void] {
  const key = `tt-board-station:${restaurantId}`;
  const [station, setStation] = useState<Station | null>(null);

  useEffect(() => {
    if (!hasStations) return;
    try {
      const saved = localStorage.getItem(key);
      if (saved === "kitchen" || saved === "bar") setStation(saved);
    } catch {
      // No storage: the screen starts on everything each time.
    }
  }, [key, hasStations]);

  function choose(next: Station | null): void {
    setStation(next);
    try {
      if (next) localStorage.setItem(key, next);
      else localStorage.removeItem(key);
    } catch {
      // Chosen for this visit only.
    }
  }

  return [hasStations ? station : null, choose];
}
