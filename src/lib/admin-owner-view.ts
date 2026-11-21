import "server-only";
import { randomUUID } from "node:crypto";
import type { PlatformAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import { restaurantSetup } from "@/lib/setup-steps-server";
import type { SetupStep } from "@/lib/setup-steps";
import type { OrderStatus } from "@/lib/types";

export interface OwnerViewOrder {
  id: string; table_label: string | null; status: OrderStatus; total: number; paid: boolean; created_at: string;
}
export interface OwnerView {
  restaurant: {
    id: string; name: string; plan: string; plan_status: string | null; currency: string;
    accepting_orders: boolean; suspended_at: string | null; charges_enabled: boolean;
  };
  setup: SetupStep[];
  menus: { id: string; name: string; active: boolean; dishes: number }[];
  tables: number;
  team: { email: string; role: string }[];
  orders: OwnerViewOrder[];
}

const RECENT_ORDERS = 15;

type AuditedOwnerView = { audited: true; view: OwnerView | null } | { audited: false };

/** Audit the attempt before reading the restaurant, then append its result. */
export async function auditedOwnerView(admin: PlatformAdmin, restaurantId: string): Promise<AuditedOwnerView> {
  const db = createAdminClient();
  const attemptId = randomUUID();
  const record = async (outcome: "started" | "succeeded" | "refused"): Promise<boolean> => {
    const { error } = await db.from("platform_admin_audit").insert({
      attempt_id: attemptId, actor_id: admin.userId, actor_email: admin.email,
      target_type: "restaurant", target_id: restaurantId, action: "restaurant.view", outcome,
      before_facts: {}, after_facts: { read_only: true },
    });
    return !error;
  };

  if (!(await record("started"))) return { audited: false };
  const view = await readOwnerView(db, restaurantId);
  if (!(await record(view ? "succeeded" : "refused"))) return { audited: false };
  return { audited: true, view };
}

/**
 * What the owner of a restaurant sees on their main screens, read with the
 * service key for a platform admin. Read only: nothing here writes, and the
 * page that shows it offers no control that would. Null when the restaurant
 * does not exist; a failed read throws, like every dashboard page.
 */
async function readOwnerView(db: ReturnType<typeof createAdminClient>, restaurantId: string): Promise<OwnerView | null> {
  const { data: restaurant, error } = await db.from("restaurants")
    .select("id, name, plan, plan_status, currency, accepting_orders, suspended_at, stripe_charges_enabled")
    .eq("id", restaurantId).maybeSingle();
  if (error) throw error;
  if (!restaurant) return null;
  const [setup, menus, dishes, tables, team, orders] = await Promise.all([
    restaurantSetup(restaurantId),
    db.from("menus").select("id, name, active").eq("restaurant_id", restaurantId).order("sort_order"),
    // Paged: a count capped at the server's thousand rows would under-report a big menu.
    everyRow<{ menu_id: string | null }>((a, b) => db.from("menu_items").select("menu_id")
      .eq("restaurant_id", restaurantId).eq("is_addon", false).order("id").range(a, b), "dishes"),
    db.from("restaurant_tables").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurantId),
    db.from("staff").select("email, role").eq("restaurant_id", restaurantId).order("email"),
    db.from("orders").select("id, table_label, status, total, paid, created_at").eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false }).limit(RECENT_ORDERS),
  ]);
  for (const r of [menus, tables, team, orders]) if (r.error) throw r.error;
  const perMenu = new Map<string, number>();
  for (const d of dishes) if (d.menu_id) perMenu.set(d.menu_id, (perMenu.get(d.menu_id) ?? 0) + 1);
  return {
    restaurant: {
      id: restaurant.id, name: restaurant.name, plan: restaurant.plan, plan_status: restaurant.plan_status,
      currency: restaurant.currency, accepting_orders: restaurant.accepting_orders,
      suspended_at: restaurant.suspended_at, charges_enabled: Boolean(restaurant.stripe_charges_enabled),
    },
    setup,
    menus: (menus.data ?? []).map(m => ({ id: m.id, name: m.name, active: m.active, dishes: perMenu.get(m.id) ?? 0 })),
    tables: tables.count ?? 0,
    team: team.data ?? [],
    orders: (orders.data ?? []) as OwnerViewOrder[],
  };
}
