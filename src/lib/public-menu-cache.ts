import { cache } from "react";
import { unstable_cache, revalidateTag } from "next/cache";
import { readPublicMenu, readPublicMenuShell } from "@/lib/public-menu-rows";

export const PUBLIC_MENU_TTL = 30;
export const publicMenuTag = (restaurantId: string): string => `public-menu:${restaurantId}`;

/** Gates write directly to the database, so only production opts in by default. */
export function publicMenuCacheEnabled(): boolean {
  return process.env.PUBLIC_MENU_CACHE === "1" ||
    (process.env.PUBLIC_MENU_CACHE !== "0" && process.env.NODE_ENV === "production" && process.env.VERCEL_ENV === "production");
}

/** Both shell and contents share one cache boundary and restaurant tag. */
async function restaurantRead<T>(restaurantId: string, part: string, read: (id: string) => Promise<T>): Promise<T> {
  if (!publicMenuCacheEnabled()) return read(restaurantId);
  // Next 15.5.28 returns expired unstable_cache entries during revalidation.
  // A new invocation key each 30 seconds prevents stale-while-revalidate from
  // crossing that bound. The bucket is an argument, never a captured value.
  return unstable_cache(async (id: string, bucket: number) => { void bucket; return read(id); }, ["public-menu-v1", part], {
    tags: [publicMenuTag(restaurantId)], revalidate: PUBLIC_MENU_TTL,
  })(restaurantId, Math.floor(Date.now() / (PUBLIC_MENU_TTL * 1000)));
}

// React deduplicates simultaneous shell questions within the current render.
export const publicMenuShell = cache((id: string) => restaurantRead(id, "shell", readPublicMenuShell));
export const publicMenuRows = cache((id: string) => restaurantRead(id, "contents", readPublicMenu));

/** Call after a diner-visible write, including a partially successful batch. */
export function invalidatePublicMenu(restaurantId: string): void {
  if (publicMenuCacheEnabled()) revalidateTag(publicMenuTag(restaurantId));
}
