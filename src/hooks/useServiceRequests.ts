"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ServiceRequest } from "@/lib/types";

/** Short double-beep so staff notice a table calling without watching. */
function playChime() {
  try {
    const ctx = new AudioContext();
    [0, 0.2].forEach(delay => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 1320;
      gain.gain.value = 0.05;
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.12);
    });
  } catch {
    // AudioContext can be blocked before user interaction — safe to ignore.
  }
}

/**
 * Live open service requests (call waiter / request bill) for one restaurant.
 * Seeds from server data, follows realtime inserts (chiming), and marks
 * requests done via the owner's RLS-scoped client.
 */
export function useServiceRequests(
  restaurantId: string,
  initialRequests: ServiceRequest[],
) {
  const [requests, setRequests] = useState<ServiceRequest[]>(initialRequests);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      // Reads are owner-only under RLS, so the socket needs the owner's token.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`service-requests-${restaurantId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "service_requests",
            filter: `restaurant_id=eq.${restaurantId}`,
          },
          payload => {
            const row = payload.new as ServiceRequest;
            setRequests(prev =>
              prev.some(r => r.id === row.id) ? prev : [row, ...prev],
            );
            playChime();
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  async function markDone(id: string): Promise<void> {
    setRequests(prev => prev.filter(r => r.id !== id)); // optimistic
    await createClient().from("service_requests").update({ status: "done" }).eq("id", id);
  }

  return { requests, markDone };
}
