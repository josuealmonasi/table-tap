"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** One "{actor} {action} a {role} user" entry from the activity log. */
export interface UserLog {
  id: string;
  actor_email: string;
  action: "created" | "updated" | "deleted";
  target_role: string;
  target_email: string;
  created_at: string;
}

export const LOGS_PER_PAGE = 20;

/**
 * Pages through the restaurant's user-activity log (newest first, 20 per
 * page). Owner-only by RLS — anyone else simply gets zero rows.
 */
export function useUserLogs(restaurantId: string) {
  const [logs, setLogs] = useState<UserLog[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const from = (page - 1) * LOGS_PER_PAGE;
      const { data, count } = await createClient()
        .from("user_logs")
        .select("id, actor_email, action, target_role, target_email, created_at", { count: "exact" })
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .range(from, from + LOGS_PER_PAGE - 1);
      if (!cancelled) {
        setLogs((data as UserLog[]) ?? []);
        setTotal(count ?? 0);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId, page]);

  const pages = Math.max(1, Math.ceil(total / LOGS_PER_PAGE));
  return { logs, loading, page, pages, total, setPage };
}
