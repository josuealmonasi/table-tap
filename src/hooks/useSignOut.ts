"use client";

import { useCallback } from "react";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { signOutEverywhere } from "@/lib/sign-out";
import type { Role } from "@/lib/membership";

/**
 * Signing out, from wherever the menu offers it — refused, and said why,
 * while this device still holds sales the till rang without a connection.
 */
/**
 * Who can send sales held offline: `TAKES_COUNTER_ORDERS`. Restated here
 * because `membership.ts` reads the server's session and cannot be imported by
 * the navbar; importing it 500'd every page (Train A gate). `sign-out.spec.tsx`
 * holds the two equal for every role.
 */
export const sendsHeldSales = (role: Role | "admin"): boolean =>
  role === "owner" || role === "manager" || role === "cashier";

export function useSignOut(role: Role | "admin"): () => void {
  const t = useT();
  const toast = useToast();
  return useCallback(() => {
    const canSend = sendsHeldSales(role);
    void signOutEverywhere(n => toast(t("pos.offlineSignOutBlocked", { n }), "error"), canSend)
      .catch(() => toast(t("pos.signOutFailed"), "error"));
  }, [t, toast, role]);
}
