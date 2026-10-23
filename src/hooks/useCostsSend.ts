"use client";

import { useCallback, useRef } from "react";
import { useRetryIntent, type RetryIntent } from "@/hooks/useRetryIntent";
import { useT } from "@/lib/i18n/context";

export interface CostsSender {
  (path: string, method: string, body: unknown): Promise<string | null>;
  pending: RetryIntent["pending"];
  discard: RetryIntent["clear"];
  frozen: RetryIntent["frozen"];
  unconfirmed: RetryIntent["unconfirmed"];
  sending: RetryIntent["sending"];
}

/**
 * Sends one change to a costs route and answers with the error to show, or
 * null when it was saved. The routes already word their refusals in the
 * owner's language; a dropped connection is worded here.
 */
export function useCostsSend(retry = false): CostsSender {
  const t = useT();
  const attempt = useRetryIntent();
  const inFlight = useRef(false);
  const send = useCallback(async (path: string, method: string, body: unknown) => {
    if (inFlight.current) return t("common.saving");
    inFlight.current = true;
    try {
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: retry && body && typeof body === "object" ? attempt.body(body) : JSON.stringify(body),
      });
      if (res.ok && !retry) return null;
      const data = await res.json();
      if (retry && ((res.ok && data.ok) || (!res.ok && attempt.settles(res.status)))) attempt.clear();
      if (res.ok && (!retry || data.ok)) return null;
      return typeof data.error === "string" ? data.error : t("apiErr.generic");
    } catch {
      return t("done.networkError");
    } finally {
      inFlight.current = false;
      attempt.ended();
    }
  }, [t, retry, attempt]);
  return Object.assign(send, { pending: attempt.pending, frozen: attempt.frozen, unconfirmed: attempt.unconfirmed, sending: attempt.sending, discard: () => { if (!inFlight.current) attempt.clear(); } });
}
