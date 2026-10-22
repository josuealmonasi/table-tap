"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n/context";
import { parsePlanLimit, planLimitText } from "@/lib/plan-error";
import { planLabel } from "@/lib/plan";
import { writeError, type WriteResult } from "@/lib/write-result";

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
      // A ceiling is not a failure the owner should read as "something broke":
      // the write was refused on purpose, and the toast has to say which limit
      // and on which plan. Anything else keeps the generic message.
      const hit = parsePlanLimit(error.message);
      if (hit) {
        const { key: limitKey, vars } = planLimitText(hit);
        toast(t(limitKey, { ...vars, plan: planLabel(vars.plan) }), "error");
      } else {
        toast(t(key), "error");
      }
    }
    return !error;
  }

  /** Runs a write and reports it. Returns whether it actually landed. */
  async function run(
    key: string,
    write: PromiseLike<WriteResult>,
    done?: string,
  ): Promise<boolean> {
    setBusy(true);
    try {
      const ok = reportError(key, writeError(await write));
      if (ok) {
        if (done) toast(t(done));
        router.refresh();
      }
      return ok;
    } catch {
      toast(t(key), "error");
      return false;
    } finally { setBusy(false); }
  }

  const addTable = (label: string): Promise<boolean> =>
    run(
      "write.createTable",
      supabase.from("restaurant_tables").insert({ restaurant_id: restaurantId, label }).select("id"),
    );

  const renameTable = (id: string, label: string): Promise<boolean> =>
    run(
      "write.renameTable",
      supabase.from("restaurant_tables").update({ label }).eq("id", id).select("id"),
    );

  const deleteTable = (id: string): Promise<boolean> =>
    run(
      "write.deleteTable",
      supabase.from("restaurant_tables").delete().eq("id", id).select("id"),
      "done.tableDeleted",
    );

  return { busy, addTable, renameTable, deleteTable };
}
