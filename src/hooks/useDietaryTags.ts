"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n/context";

export interface DietaryTagInput {
  label: string;
  labelEn?: string | null;
  emoji?: string;
}

/**
 * Adding, changing and removing dietary tags.
 *
 * Refreshes from the server rather than keeping its own copy: the tags come
 * from the same query that paints the editor and the diner's menu, and a
 * second list here would be another place the truth can drift apart.
 */
export function useDietaryTags() {
  const router = useRouter();
  const toast = useToast();
  const t = useT();
  const [busy, setBusy] = useState(false);

  async function send(method: "POST" | "PATCH" | "DELETE", body: unknown): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch("/api/dietary-tags", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error ?? t("apiErr.generic"), "error");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      toast(t("apiErr.generic"), "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    addTag: (input: DietaryTagInput) => send("POST", input),
    updateTag: (id: string, input: Partial<DietaryTagInput>) => send("PATCH", { id, ...input }),
    deleteTag: (id: string) => send("DELETE", { id }),
  };
}
