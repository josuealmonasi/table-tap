"use client";

import { createContext, useContext, useLayoutEffect, useRef } from "react";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useT } from "@/lib/i18n/context";

export interface CloseGuard { current: (() => Promise<boolean>) | null; confirming?: boolean }
export const DirtyCloseContext = createContext<CloseGuard | null>(null);

/** The form owns dirty state; its modal and Cancel button ask the same question. */
export function useDirtyClose(dirty: boolean, onClose: () => void, busy = false): () => void {
  const modal = useContext(DirtyCloseContext);
  const confirm = useConfirm();
  const t = useT();
  const pending = useRef<Promise<boolean> | null>(null);
  const mounted = useRef(true);
  const latest = useRef({ dirty, busy });
  useLayoutEffect(() => { latest.current = { dirty, busy }; });
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  async function allowed(): Promise<boolean> {
    if (latest.current.busy) return false;
    if (!latest.current.dirty) return true;
    // Holding Escape or clicking twice must never replace an unanswered ask.
    if (!pending.current) {
      if (modal) modal.confirming = true;
      pending.current = confirm({ title: t("common.discardTitle"), message: t("common.discardBody"), confirmLabel: t("common.discard"), cancelLabel: t("common.keepEditing"), danger: true });
    }
    // A save or unmount can overtake the question; its answer cannot close it.
    try { return await pending.current && !latest.current.busy && mounted.current; } finally { pending.current = null; if (modal) modal.confirming = false; }
  }
  useLayoutEffect(() => {
    if (!modal) return;
    modal.current = allowed;
    return () => { if (modal.current === allowed) modal.current = null; };
  });
  return () => { void allowed().then(ok => { if (ok) onClose(); }); };
}
