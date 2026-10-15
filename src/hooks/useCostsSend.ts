"use client";

import { useCallback } from "react";
import { useT } from "@/lib/i18n/context";

/**
 * Sends one change to a costs route and answers with the error to show, or
 * null when it was saved. The routes already word their refusals in the
 * owner's language; a dropped connection is worded here.
 */
export function useCostsSend(): (path: string, method: string, body: unknown) => Promise<string | null> {
  const t = useT();
  return useCallback(async (path, method, body) => {
    try {
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return null;
      const data = await res.json().catch(() => ({}));
      return typeof data.error === "string" ? data.error : t("apiErr.generic");
    } catch {
      return t("done.networkError");
    }
  }, [t]);
}
