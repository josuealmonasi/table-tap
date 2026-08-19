"use client";

import { useEffect, useState } from "react";
import { forgetSitting, recallSitting } from "@/lib/table-binding";

export interface OpenElsewhere {
  tableLabel: string;
  owed: number;
}

/**
 * Whether this phone already owes for a different table.
 *
 * Asked once when a menu loads. The answer comes from the server, because the
 * phone only remembers an id — whether that sitting is still open, and whether
 * anything is still owed on it, is not the phone's to decide.
 *
 * A sitting that has been paid, written off, or has simply aged out comes back
 * closed, and the note it left on this device is thrown away. That is the
 * "resets itself" half: nobody has to remember to unbind anybody.
 */
export function useSitting(
  restaurantId: string,
  tableId: string | null,
): OpenElsewhere | null {
  const [elsewhere, setElsewhere] = useState<OpenElsewhere | null>(null);

  useEffect(() => {
    if (!tableId) return; // a counter order binds nobody
    const sitting = recallSitting(restaurantId);
    if (!sitting || sitting.tableId === tableId) return;

    let active = true;
    fetch(`/api/session?id=${sitting.sessionId}`)
      .then(r => (r.ok ? r.json() : { open: false }))
      .then((d: { open: boolean; tableLabel?: string; owed?: number }) => {
        if (!active) return;
        if (!d.open) {
          forgetSitting(restaurantId); // settled or aged out: they are free
          return;
        }
        setElsewhere({ tableLabel: d.tableLabel ?? "", owed: d.owed ?? 0 });
      })
      .catch(() => {
        // A check we could not make must not stop somebody ordering dinner.
      });

    return () => {
      active = false;
    };
  }, [restaurantId, tableId]);

  return elsewhere;
}
