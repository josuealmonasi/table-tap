"use client";

import { useCallback, useEffect, useState } from "react";
import { requestPhoneMembership, type PhoneMembership } from "@/lib/table-member-client";
export type { PhoneMembership } from "@/lib/table-member-client";
import type { PendingPhone } from "@/lib/table-member-requests";
import { MEMBER_POLL_MS } from "@/lib/poll";
import { rememberSitting } from "@/lib/table-binding";

interface MembershipRead {
  scope: string;
  state: PhoneMembership | null;
  pending: PendingPhone[];
  error: boolean;
  pendingError: boolean;
}
const emptyRead = (scope: string): MembershipRead => ({ scope, state: null, pending: [], error: false, pendingError: false });

/** Anonymous phones poll: opening membership rows to realtime would expose credentials. */
export function useTableMembership(restaurantId: string, tableId: string | null) {
  const scope = `${restaurantId}:${tableId ?? ""}`;
  const [result, setResult] = useState(() => emptyRead(scope));
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(n => n + 1), []);

  useEffect(() => {
    const targetTable = tableId;
    if (!targetTable) return;
    let active = true;
    let running = false;
    const controller = new AbortController();
    const read = async () => {
      if (running) return;
      running = true;
      try {
        const next = await requestPhoneMembership(restaurantId, targetTable, controller.signal);
        if (!active) return;
        const approved = next.status === "approved" && next.sessionId !== null;
        if (approved && next.sessionId) rememberSitting(restaurantId, next.sessionId, targetTable);
        setResult(previous => ({
          scope, state: next, error: false, pendingError: approved && next.pending == null,
          pending: approved ? next.pending ?? (
            previous.scope === scope && previous.state?.sessionId === next.sessionId ? previous.pending : []
          ) : [],
        }));
      } catch {
        if (active) setResult(previous => ({ ...(previous.scope === scope ? previous : emptyRead(scope)), error: true }));
      } finally { running = false; }
    };
    read();
    const timer = setInterval(read, MEMBER_POLL_MS);
    const visible = () => { if (document.visibilityState === "visible") read(); };
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [restaurantId, tableId, scope, revision]);

  // A changed table cannot render the old sitting while its first poll waits.
  const current = result.scope === scope ? result : emptyRead(scope);
  return { state: current.state, pending: current.pending, error: current.error, pendingError: current.pendingError, refresh };
}
