"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";

/** A staff login row as the owner sees it. */
export interface StaffMember {
  id: string;
  email: string;
  created_at: string;
}

/**
 * The owner's staff list. Reads via the RLS-scoped client; add/remove go
 * through /api/staff because creating/deleting logins needs the secret key.
 */
export function useStaff(restaurantId: string) {
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await createClient()
        .from("staff")
        .select("id, email, created_at")
        .eq("restaurant_id", restaurantId)
        .order("created_at");
      if (!cancelled) {
        setMembers((data as StaffMember[]) ?? []);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  async function refresh(): Promise<void> {
    const { data } = await createClient()
      .from("staff")
      .select("id, email, created_at")
      .eq("restaurant_id", restaurantId)
      .order("created_at");
    setMembers((data as StaffMember[]) ?? []);
  }

  async function addMember(email: string, password: string): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? "Could not add the staff member.", "error");
        return false;
      }
      toast("Staff login created");
      await refresh();
      return true;
    } catch {
      toast("Network error — please try again.", "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(id: string): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch("/api/staff", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? "Could not remove the login.", "error");
        return;
      }
      toast("Staff login removed");
      setMembers((prev) => prev.filter((m) => m.id !== id));
    } catch {
      toast("Network error — please try again.", "error");
    } finally {
      setBusy(false);
    }
  }

  return { members, loading, busy, addMember, removeMember };
}
