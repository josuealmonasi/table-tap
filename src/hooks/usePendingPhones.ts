"use client";

import { useCallback, useEffect, useState } from "react";
import type { PendingPhone } from "@/lib/table-member-requests";
import { membershipRead } from "@/lib/membership-read";
import { MEMBER_POLL_MS } from "@/lib/poll";

/**
 * Like service requests, admission stays current without reloading the board.
 *
 * The next read is scheduled MEMBER_POLL_MS after the last one settles, never
 * on a fixed tick. A fixed 5 s interval kept firing however long the read
 * took, so a slow database left Pedidos with a request in flight almost all
 * the time: the page never went quiet, and the database was asked again
 * before it had answered.
 */
export function usePendingPhones(restaurantId: string, enabled: boolean) {
  const [pending, setPending] = useState<PendingPhone[]>([]);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function read() {
      try {
        const data = await membershipRead<{ pending?: PendingPhone[] }>(
          `/api/table-membership?restaurantId=${restaurantId}`, { signal: controller.signal },
        );
        if (active) setPending(data.pending ?? []);
      } catch { /* A lost poll keeps the requests that were already visible. */ }
      finally { if (active) timer = setTimeout(read, MEMBER_POLL_MS); }
    }
    void read();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [restaurantId, enabled, revision]);
  return { pending: enabled ? pending : [], refresh };
}
