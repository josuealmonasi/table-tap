"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n/context";

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
      call("/api/admin/users", "POST", input, "Login created"),
    updateUser: (input: {
      userId: string;
      fullName?: string;
      email?: string;
      password?: string;
      role?: string;
    }) => call("/api/admin/users", "PATCH", input, "Login updated"),
    deleteUser: (userId: string) =>
      call("/api/admin/users", "DELETE", { userId }, "Login deleted"),
    deleteRestaurant: (id: string) =>
      call("/api/admin/restaurants", "DELETE", { id }, "Restaurant deleted"),
  };
}
