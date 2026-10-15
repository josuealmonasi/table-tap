"use client";

import { useCallback } from "react";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { signOutEverywhere } from "@/lib/sign-out";

/**
 * Signing out, from wherever the menu offers it — refused, and said why,
 * while this device still holds sales the till rang without a connection.
 */
export function useSignOut(): () => void {
  const t = useT();
  const toast = useToast();
  return useCallback(() => {
    void signOutEverywhere(n => toast(t("pos.offlineSignOutBlocked", { n }), "error"));
  }, [t, toast]);
}
