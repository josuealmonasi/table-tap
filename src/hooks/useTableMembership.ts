"use client";

import { useCallback, useEffect, useState } from "react";
import { requestPhoneMembership, type PhoneMembership } from "@/lib/table-member-client";
export type { PhoneMembership } from "@/lib/table-member-client";
import type { PendingPhone } from "@/lib/table-member-requests";
import { MEMBER_POLL_MS } from "@/lib/poll";
import { rememberSitting } from "@/lib/table-binding";

/** Anonymous phones poll: opening membership rows to realtime would expose credentials. */
export function useTableMembership(restaurantId: string, tableId: string | null) {
  const [state, setState] = useState<PhoneMembership | null>(null);
  const [pending, setPending] = useState<PendingPhone[]>([]);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(n => n + 1), []);

  useEffect(() => { setState(null); setPending([]); setError(false); }, [restaurantId, tableId]);

  useEffect(() => {
    const targetTable = tableId;
    if (!targetTable) return;
    let active = true;
    let running = false;
    const read = async () => {
      if (running) return;
      running = true;
      try {
        const next = await requestPhoneMembership(restaurantId, targetTable);
        if (!active) return;
        setError(false);
        setState(next);
        if (next.status === "approved" && next.sessionId && tableId) {
          rememberSitting(restaurantId, next.sessionId, tableId);
          const requests = await fetch(`/api/table-membership?restaurantId=${restaurantId}&tableId=${tableId}`);
          if (requests.ok) {
            const data = await requests.json();
            if (active) setPending(data.pending ?? []);
          }
        } else setPending([]);
      } catch {
        if (active) setError(true);
      } finally { running = false; }
    };
    read();
    const timer = setInterval(read, MEMBER_POLL_MS);
    const visible = () => { if (document.visibilityState === "visible") read(); };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [restaurantId, tableId, revision]);

  return { state, pending, error, refresh };
}
