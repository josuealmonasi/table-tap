"use client";

import { useEffect, useState } from "react";

const KEY = "tt:rows:";

/**
 * Remembers how many rows a list actually had, so its shimmer can render the
 * same number next time.
 *
 * A fixed guess is wrong nearly every visit: three placeholder rows in front of
 * seven real ones means everything below jumps down the moment the data lands.
 * Restaurants add a menu or hire a waiter occasionally, not between page loads,
 * so last visit's count is a far better prediction than any constant we could
 * pick — and after the first load the layout stops moving entirely.
 *
 * @param key      stable id for the list, e.g. "menus" or "staff"
 * @param fallback rows to show before we've ever seen the real list
 * @param actual   the real count once loaded, or undefined while loading
 */
export function useRowMemory(key: string, fallback: number, actual?: number): number {
  const [remembered, setRemembered] = useState(fallback);

  // Read on mount only: during SSR there's no localStorage, and rendering a
  // different count on the server than the client would trip hydration.
  useEffect(() => {
    const stored = Number(window.localStorage.getItem(KEY + key));
    if (Number.isFinite(stored) && stored > 0) setRemembered(stored);
  }, [key]);

  useEffect(() => {
    if (actual === undefined) return;
    window.localStorage.setItem(KEY + key, String(actual));
  }, [key, actual]);

  return remembered;
}
