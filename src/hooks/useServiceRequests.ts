"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n/context";
import { serviceRequestCutoff } from "@/lib/service-requests";
import type { BoardRequest } from "@/lib/kitchen-ticket";

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
 * requests done via the floor's RLS-scoped client or the kitchen's scoped route.
 */
export function useServiceRequests(
  restaurantId: string,
  initialRequests: BoardRequest[],
  kitchen = false,
  readFailed = false,
) {
  const [requests, setRequests] = useState<BoardRequest[]>(initialRequests);
  const [now, setNow] = useState<number | null>(null);
  // A board left open through service must age calls out just like a fresh read.
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const toast = useToast();
  const t = useT();

  // A fresh server render is the truth. Without this the list was seeded once
  // and never corrected, so a request answered elsewhere — or settled through
  // the till — kept asking on this screen until a full reload.
  useEffect(() => {
    if (!readFailed) setRequests(initialRequests);
  }, [initialRequests, readFailed]);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      // The kitchen follows labels without table credentials; both feeds use
      // the member's token so RLS checks the socket as well as the first read.
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
            table: kitchen ? "kitchen_requests" : "service_requests",
            filter: `restaurant_id=eq.${restaurantId}`,
          },
          payload => {
            const row = payload.new as BoardRequest;
            setRequests(prev =>
              prev.some(r => r.id === row.id) ? prev : [row, ...prev],
            );
            playChime();
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: kitchen ? "kitchen_requests" : "service_requests",
            filter: `restaurant_id=eq.${restaurantId}`,
          },
          payload => {
            // A request answered anywhere else — the settle dialog closing one
            // server-side, or another waiter's phone marking it done — has to
            // leave this board too. Without this only the device that pressed
            // the button stopped showing it, so everyone else kept being asked
            // to handle something already handled.
            const row = payload.new as BoardRequest;
            if (row.status !== "open") {
              setRequests(prev => prev.filter(r => r.id !== row.id));
            }
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [restaurantId, kitchen]);

  async function markDone(id: string): Promise<void> {
    const handled = requests.find(r => r.id === id);
    setRequests(prev => prev.filter(r => r.id !== id)); // optimistic
    let error: unknown;
    try {
      if (kitchen) {
        const res = await fetch("/api/service-requests", {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        error = !res.ok;
      } else {
        ({ error } = await createClient().from("service_requests").update({ status: "done" }).eq("id", id));
      }
    } catch {
      error = true;
    }
    // Put back when it did not land. It was left hidden here and pending on
    // every other screen: a table two waiters each think the other answered.
    if (error) {
      if (handled) setRequests(prev => (prev.some(r => r.id === id) ? prev : [handled, ...prev]));
      toast(t("service.doneFailed"), "error");
    }
  }

  return { requests: now === null ? requests : requests.filter(r =>
    r.status === "open" && Date.parse(r.created_at) >= Date.parse(serviceRequestCutoff(now)),
  ), markDone };
}
