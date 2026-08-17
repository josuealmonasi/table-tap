"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n/context";

/**
 * Saves the logged-in user's profile. The name lives in our `profiles` table
 * (own-row RLS); email and password go through Supabase auth, which handles
 * them safely — an email change must be confirmed from the new inbox.
 */
export function useProfile(userId: string) {
  const supabase = createClient();
  const toast = useToast();
  const t = useT();
  const [saving, setSaving] = useState(false);

  async function saveName(fullName: string): Promise<boolean> {
    setSaving(true);
    const { error } = await supabase.from("profiles").upsert({
      user_id: userId,
      full_name: fullName.trim(),
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    if (error) {
      console.error("write.saveProfile:", error.message);
      toast(t("write.saveProfile"), "error");
      return false;
    }
    toast(t("done.profileSaved"));
    return true;
  }

  async function saveEmail(email: string): Promise<boolean> {
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ email });
    setSaving(false);
    if (error) {
      console.error("write.updateEmail:", error.message);
      toast(t("write.updateEmail"), "error");
      return false;
    }
    toast(t("done.emailConfirmSent"));
    return true;
  }

  async function savePassword(password: string): Promise<boolean> {
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      console.error("write.updatePassword:", error.message);
      toast(t("write.updatePassword"), "error");
      return false;
    }
    toast(t("done.passwordUpdated"));
    return true;
  }

  return { saving, saveName, saveEmail, savePassword };
}
