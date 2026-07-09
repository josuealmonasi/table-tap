"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import type { Restaurant } from "@/lib/types";

/** The restaurant fields the owner can edit from Settings. */
export type SettingsInput = Pick<
  Restaurant,
  "name" | "logo" | "tagline" | "currency" | "service_pct" | "service_enabled" | "accepting_orders"
>;

/**
 * Saves restaurant settings via the RLS-protected browser client (authorised as
 * the logged-in owner). On success it calls router.refresh() so the server
 * re-renders — the navbar picks up a new name/logo. Toasts on success/failure.
 */
export function useSettings(restaurantId: string) {
  const supabase = createClient();
  const router = useRouter();
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  async function save(input: Partial<SettingsInput>, message = "Settings saved"): Promise<boolean> {
    setSaving(true);
    const { error } = await supabase
      .from("restaurants")
      .update(input)
      .eq("id", restaurantId);
    setSaving(false);
    if (error) {
      toast(`Couldn't save settings: ${error.message}`, "error");
      return false;
    }
    toast(message);
    router.refresh();
    return true;
  }

  return { saving, save };
}
