"use client";

import { useCallback, useRef } from "react";
import { useRetryIntent, refusalSettles } from "@/hooks/useRetryIntent";
import { useT } from "@/lib/i18n/context";

/**
 * Sends one change to a costs route and answers with the error to show, or
 * null when it was saved. The routes already word their refusals in the
 * owner's language; a dropped connection is worded here.
 */
export function useCostsSend(retry = false): (path: string, method: string, body: unknown) => Promise<string | null> {
  const t = useT();
  const attempt = useRetryIntent();
  const inFlight = useRef(false);
  return useCallback(async (path, method, body) => {
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
      if (retry && ((res.ok && data.ok) || (!res.ok && refusalSettles(res.status)))) attempt.clear();
      if (res.ok && (!retry || data.ok)) return null;
      return typeof data.error === "string" ? data.error : t("apiErr.generic");
    } catch {
      return t("done.networkError");
    } finally {
      inFlight.current = false;
    }
  }, [t, retry, attempt]);
}
