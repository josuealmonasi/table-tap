"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n/context";
import type { TierAssignment } from "@/components/dashboard/admin/AdminTierDialog";

export interface NewUserInput {
  email: string;
  password: string;
  role: "admin" | "owner" | "manager" | "kitchen";
  restaurantId?: string;
  restaurantName?: string;
}

/** Platform-admin mutations; the page's server data refreshes after each. */
export function useAdminActions() {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function call(
    path: string,
    method: string,
    body: unknown,
    okMsg: string,
  ): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? t("apiErr.generic"), "error");
        return false;
      }
      toast(okMsg);
      router.refresh();
      return true;
    } catch {
      toast(t("done.networkError"), "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    createUser: (input: NewUserInput) =>
      call("/api/admin/users", "POST", input, t("admin.loginCreated")),
    updateUser: (input: {
      userId: string;
      fullName?: string;
      email?: string;
      password?: string;
      role?: string;
    }) => call("/api/admin/users", "PATCH", input, t("admin.loginUpdated")),
    transferOwner: (restaurantId: string, userId: string, doneMsg: string) =>
      call("/api/admin/restaurants/owner", "POST", { id: restaurantId, userId }, doneMsg),
    deleteUser: (userId: string) =>
      call("/api/admin/users", "DELETE", { userId }, t("admin.loginDeleted")),
    deleteRestaurant: (id: string) =>
      call("/api/admin/restaurants", "DELETE", { id }, t("admin.restaurantDeleted")),
    schedulePrice: (plan: string, newPrice: number, effectiveAt: string, doneMsg: string) =>
      call("/api/admin/plan-price-changes", "POST", { plan, newPrice, effectiveAt }, doneMsg),
    suspend: (id: string, reason: string, doneMsg: string) =>
      call("/api/admin/restaurants/suspend", "POST", { id, reason }, doneMsg),
    changeTrial: (id: string, endsAt: string | null, doneMsg: string) =>
      call("/api/admin/restaurants/trial", "PATCH", { id, endsAt }, doneMsg),
    liftSuspension: (id: string, doneMsg: string) =>
      call("/api/admin/restaurants/suspend", "DELETE", { id }, doneMsg),
    movePlan: (id: string, plan: string, doneMsg: string, choice: TierAssignment) =>
      call("/api/admin/restaurants", "PATCH", { id, plan, ...choice }, doneMsg),
  };
}
