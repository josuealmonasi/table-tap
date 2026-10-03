"use client";

import { useEffect, useMemo, useState } from "react";
import type { MenuItem } from "@/lib/types";
import { forgetUsual, readUsual, resolveUsual, type UsualEntry } from "@/lib/usual";

/**
 * "Lo de siempre": what this phone usually orders here, as today's menu can
 * make it.
 *
 * Read after mount — the server has no localStorage, and deciding there would
 * flash a tab at a phone that has no usual. Recomputed whenever the menu is.
 */
export function useUsualOrder(
  restaurantId: string,
  items: MenuItem[],
  extras: MenuItem[],
  extrasByProduct: Record<string, string[]>,
): { usual: ReturnType<typeof resolveUsual>; forget: () => void } {
  const [entries, setEntries] = useState<UsualEntry[]>([]);
  useEffect(() => setEntries(readUsual(restaurantId)), [restaurantId]);
  const usual = useMemo(
    () => resolveUsual(entries, items, extras, extrasByProduct),
    [entries, items, extras, extrasByProduct],
  );

  function forget(): void {
    forgetUsual(restaurantId);
    setEntries([]);
  }

  return { usual, forget };
}
