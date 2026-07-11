"use client";

import { useState } from "react";

/** Checkbox multi-select state for the menu editor's bulk actions. */
export function useBulkSelect() {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exit(): void {
    setSelecting(false);
    setSelected(new Set());
  }

  return { selecting, setSelecting, selected, toggle, exit };
}
