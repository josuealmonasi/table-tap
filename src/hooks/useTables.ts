"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";

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
  const [busy, setBusy] = useState(false);

  function reportError(action: string, error: { message: string } | null): boolean {
    if (error) toast(`Couldn't ${action}: ${error.message}`, "error");
    return !error;
  }

  async function run(action: string, write: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
    setBusy(true);
    const { error } = await write;
    if (reportError(action, error)) router.refresh();
    setBusy(false);
  }

  const addTable = (label: string): Promise<void> =>
    run("add the table", supabase.from("restaurant_tables").insert({ restaurant_id: restaurantId, label }));

  const renameTable = (id: string, label: string): Promise<void> =>
    run("rename the table", supabase.from("restaurant_tables").update({ label }).eq("id", id));

  const deleteTable = (id: string): Promise<void> =>
    run("delete the table", supabase.from("restaurant_tables").delete().eq("id", id));

  return { busy, addTable, renameTable, deleteTable };
}
