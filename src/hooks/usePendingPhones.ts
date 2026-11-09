"use client";

import { useCallback, useEffect, useState } from "react";
import type { PendingPhone } from "@/lib/table-member-requests";
import { membershipRead } from "@/lib/membership-read";
import { MEMBER_POLL_MS } from "@/lib/poll";

/** Like service requests, admission stays current without reloading the board. */
export function usePendingPhones(restaurantId: string, enabled: boolean) {
  const [pending, setPending] = useState<PendingPhone[]>([]);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let running = false;
    const controller = new AbortController();
    async function read() {
      if (running) return;
      running = true;
      try {
        const data = await membershipRead<{ pending?: PendingPhone[] }>(
          `/api/table-membership?restaurantId=${restaurantId}`, { signal: controller.signal },
        );
        if (active) setPending(data.pending ?? []);
      } catch { /* A lost poll keeps the requests that were already visible. */ }
      finally { running = false; }
    }
    read();
    const timer = setInterval(read, MEMBER_POLL_MS);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, [restaurantId, enabled, revision]);
  return { pending: enabled ? pending : [], refresh };
}
