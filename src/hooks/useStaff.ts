"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { useT } from "@/lib/i18n/context";

export type StaffRole = "owner" | "manager" | "waiter" | "cashier" | "kitchen";

/** A staff login row as the owner sees it. */
export interface StaffMember {
  id: string;
  email: string;
  role: StaffRole;
  created_at: string;
  /** From the member's own profile page, when they've filled it in. */
  full_name?: string;
}

/** Staff rows plus each member's profile name (when they've filled it in). */
async function fetchMembers(restaurantId: string): Promise<StaffMember[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("staff")
    .select("id, email, role, created_at, user_id")
    .eq("restaurant_id", restaurantId)
    .order("created_at");
  const rows = (data as (StaffMember & { user_id: string })[]) ?? [];
  if (rows.length === 0) return [];

  // Names live in profiles (the owner may read their staff's rows under RLS).
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, full_name")
    .in(
      "user_id",
      rows.map(r => r.user_id),
    );
  const names = new Map(
    ((profiles as { user_id: string; full_name: string }[]) ?? []).map(p => [
      p.user_id,
      p.full_name,
    ]),
  );
  return rows.map(({ user_id, ...rest }) => ({
    ...rest,
    full_name: names.get(user_id) || undefined,
  }));
}

/**
 * The owner's staff list. Reads via the RLS-scoped client; add/remove go
 * through /api/staff because creating/deleting logins needs the secret key.
 */
export function useStaff(restaurantId: string) {
  const t = useT();
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const members = await fetchMembers(restaurantId);
      if (!cancelled) {
        setMembers(members);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  async function refresh(): Promise<void> {
    setMembers(await fetchMembers(restaurantId));
  }

  async function addMember(email: string, role: StaffRole): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch("/api/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? t("apiErr.staffAdd"), "error");
        return false;
      }
      toast(t("done.inviteSentTo", { email }));
      await refresh();
      return true;
    } catch {
      toast(t("done.networkError"), "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function updateRole(id: string, role: StaffRole): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch("/api/staff", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? t("apiErr.staffRole"), "error");
        return;
      }
      toast("Role updated");
      setMembers(prev => prev.map(m => (m.id === id ? { ...m, role } : m)));
    } catch {
      toast(t("done.networkError"), "error");
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
        toast(data.error ?? t("apiErr.loginRemove"), "error");
        return;
      }
      toast("Staff login removed");
      setMembers(prev => prev.filter(m => m.id !== id));
    } catch {
      toast(t("done.networkError"), "error");
    } finally {
      setBusy(false);
    }
  }

  return { members, loading, busy, addMember, updateRole, removeMember };
}
