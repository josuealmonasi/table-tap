"use client";

import { useCallback } from "react";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { signOutEverywhere } from "@/lib/sign-out";
import { TAKES_COUNTER_ORDERS, type Role } from "@/lib/membership";

/**
 * Signing out, from wherever the menu offers it — refused, and said why,
 * while this device still holds sales the till rang without a connection.
 */
export function useSignOut(role: Role | "admin"): () => void {
  const t = useT();
  const toast = useToast();
  return useCallback(() => {
    const canSend = role !== "admin" && TAKES_COUNTER_ORDERS(role);
    void signOutEverywhere(n => toast(t("pos.offlineSignOutBlocked", { n }), "error"), canSend)
      .catch(() => toast(t("pos.signOutFailed"), "error"));
  }, [t, toast, role]);
}
