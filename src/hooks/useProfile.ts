"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";

/**
 * Saves the logged-in user's profile. The name lives in our `profiles` table
 * (own-row RLS); email and password go through Supabase auth, which handles
 * them safely — an email change must be confirmed from the new inbox.
 */
export function useProfile(userId: string) {
  const supabase = createClient();
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  async function saveName(fullName: string): Promise<boolean> {
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .upsert({ user_id: userId, full_name: fullName.trim(), updated_at: new Date().toISOString() });
    setSaving(false);
    if (error) {
      toast(`Couldn't save your name: ${error.message}`, "error");
      return false;
    }
    toast("Profile saved");
    return true;
  }

  async function saveEmail(email: string): Promise<boolean> {
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ email });
    setSaving(false);
    if (error) {
      toast(`Couldn't update email: ${error.message}`, "error");
      return false;
    }
    toast("Check your new inbox to confirm the email change");
    return true;
  }

  async function savePassword(password: string): Promise<boolean> {
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      toast(`Couldn't update password: ${error.message}`, "error");
      return false;
    }
    toast("Password updated");
    return true;
  }

  return { saving, saveName, saveEmail, savePassword };
}
