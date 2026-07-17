"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import type { Restaurant } from "@/lib/types";

/** The restaurant fields editable from Settings (server enforces per role). */
export type SettingsInput = Pick<
  Restaurant,
  | "name"
  | "logo"
  | "tagline"
  | "currency"
  | "service_pct"
  | "service_enabled"
  | "tax_pct"
  | "tax_show_breakdown"
  | "accepting_orders"
>;

/**
 * Saves restaurant settings through the role-checked /api/settings route
 * (owners edit everything; managers only the operational fields). On success
 * it router.refresh()es so the server re-renders. Toasts on success/failure.
 */
export function useSettings() {
  const router = useRouter();
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  async function save(
    input: Partial<SettingsInput>,
    message = "Settings saved",
  ): Promise<boolean> {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? "Couldn't save settings.", "error");
        return false;
      }
      toast(message);
      router.refresh();
      return true;
    } catch {
      toast("Network error — please try again.", "error");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { saving, save };
}
