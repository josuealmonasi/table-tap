"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n/context";
import type { Restaurant } from "@/lib/types";

/** The restaurant fields editable from Settings (server enforces per role). */
export type SettingsInput = Pick<
  Restaurant,
  | "name"
  | "logo"
  | "tagline"
  | "currency"
  | "timezone"
  | "service_pct"
  | "service_enabled"
  | "tax_pct"
  | "tax_show_breakdown"
  | "accepting_orders"
  | "cover_url"
  | "cover_enabled"
  | "logo_url"
  | "allow_pay_later"
  | "allow_counter_payment"
  | "badges_enabled"
>;

/**
 * Saves restaurant settings through the role-checked /api/settings route
 * (owners edit everything; managers only the operational fields). On success
 * it router.refresh()es so the server re-renders. Toasts on success/failure.
 */
export function useSettings() {
  const router = useRouter();
  const toast = useToast();
  const t = useT();
  const [saving, setSaving] = useState(false);

  /** @param messageKey i18n key for the success toast. */
  async function save(
    input: Partial<SettingsInput>,
    messageKey = "dash.settingsSaved",
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
        // The route already answers in the caller's language.
        toast(data.error ?? t("dash.settingsSaveFailed"), "error");
        return false;
      }
      toast(t(messageKey));
      router.refresh();
      return true;
    } catch {
      toast(t("dash.networkError"), "error");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { saving, save };
}
