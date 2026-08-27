"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n/context";
import type { IconVariant } from "@/lib/icon-groups";

export interface IconGroupInput {
  name: string;
  variant: IconVariant;
  icons: { emoji: string; label?: string }[];
}

/**
 * Alta, cambio y baja de los grupos del selector de iconos.
 *
 * Refresca del servidor en vez de llevar su propia copia: los grupos salen de
 * la misma consulta que pinta el editor, y una segunda lista aquí sería otro
 * sitio donde la verdad puede separarse.
 */
export function useIconGroups() {
  const router = useRouter();
  const toast = useToast();
  const t = useT();
  const [busy, setBusy] = useState(false);

  async function send(method: "POST" | "PATCH" | "DELETE", body: unknown): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch("/api/icon-groups", {
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
    addGroup: (input: IconGroupInput) => send("POST", input),
    updateGroup: (id: string, input: Partial<IconGroupInput>) => send("PATCH", { id, ...input }),
    deleteGroup: (id: string) => send("DELETE", { id }),
  };
}
