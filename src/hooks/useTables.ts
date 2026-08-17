"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n/context";

/**
 * CRUD for a restaurant's tables via the RLS-protected browser client (writes
 * authorised as the logged-in owner). After each change it calls
 * router.refresh() so the server re-renders the page with fresh tables and
 * regenerated QR codes. Surfaces a toast if a write fails.
 */
export function useTables(restaurantId: string) {
  const supabase = createClient();
  const router = useRouter();
  const toast = useToast();
  const t = useT();
  const [busy, setBusy] = useState(false);

  /**
   * `key` names the action in the user's language. The raw Supabase message is
   * logged rather than shown — it is English whatever the UI is set to, and it
   * tells a restaurant owner nothing they can act on.
   */
  function reportError(key: string, error: { message: string } | null): boolean {
    if (error) {
      console.error(`${key}:`, error.message);
      toast(t(key), "error");
    }
    return !error;
  }

  async function run(
    key: string,
    write: PromiseLike<{ error: { message: string } | null }>,
    done?: string,
  ): Promise<void> {
    setBusy(true);
    const { error } = await write;
    if (reportError(key, error)) {
      if (done) toast(t(done));
      router.refresh();
    }
    setBusy(false);
  }

  const addTable = (label: string): Promise<void> =>
    run(
      "write.createTable",
      supabase.from("restaurant_tables").insert({ restaurant_id: restaurantId, label }),
    );

  const renameTable = (id: string, label: string): Promise<void> =>
    run(
      "write.renameTable",
      supabase.from("restaurant_tables").update({ label }).eq("id", id),
    );

  const deleteTable = (id: string): Promise<void> =>
    run(
      "write.deleteTable",
      supabase.from("restaurant_tables").delete().eq("id", id),
      "done.tableDeleted",
    );

  return { busy, addTable, renameTable, deleteTable };
}
