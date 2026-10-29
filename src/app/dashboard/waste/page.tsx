import type { Modifier } from "@/lib/types";
import { requireMembership } from "@/lib/page-guard";
import { MANAGES } from "@/lib/membership";
import { allPlans, getPlan } from "@/lib/plan-server";
import { can, cheapestWith } from "@/lib/plan";
import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow, everyRowIn } from "@/lib/paged";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";
import { startOfLocalDay } from "@/lib/day-window";
import Breadcrumb from "@/components/layout/Breadcrumb";
import PlanLock from "@/components/dashboard/plan/PlanLock";
import WasteRecorder, { type WasteChoice, type TodayEntry } from "@/components/dashboard/costs/WasteRecorder";

export const dynamic = "force-dynamic";

/**
 * /dashboard/waste — what was thrown away, recorded by whoever threw it: the
 * barista who spilled the milk, the cook whose plate went back. The whole
 * team; what it cost is shown to the owner and the managers only, who read
 * the rest of it on the costs screen.
 */
export default async function WastePage() {
  const membership = await requireMembership();
  const r = membership.restaurant;
  const plan = await getPlan(r.id);
  const crumbs = [{ labelKey: "nav.dashboard", href: "/dashboard" }, { labelKey: "nav.waste" }];

  if (!plan || !can(plan.limits, "costs")) {
    const unlocks = cheapestWith(await allPlans(), "costs", plan?.limits);
    return (
      <div className="tt-dash">
        <div className="container">
          <header className="tt-dash-head"><Breadcrumb trail={crumbs} /></header>
          <PlanLock feature="costs" unlocksWith={unlocks?.plan ?? "casa"} isOwner={membership.role === "owner"} />
        </div>
      </div>
    );
  }

  const db = createAdminClient();
  const timeZone = r.timezone ?? DEFAULT_TIME_ZONE;
  const canSeeCost = MANAGES(membership.role);
  const [ingredients, products, menus, today] = await Promise.all([
    everyRow<{ id: string; name: string; unit: "g" | "ml" | "pza" }>((a, b) => db.from("ingredients")
      .select("id, name, unit").eq("restaurant_id", r.id).is("archived_at", null).order("id").range(a, b), "the ingredients"),
    everyRow<{ id: string; name: string; emoji: string | null; menu_id: string | null; modifiers: Modifier[]; is_addon: boolean }>((a, b) => db.from("menu_items")
      .select("id, name, emoji, menu_id, modifiers, is_addon").eq("restaurant_id", r.id).order("id").range(a, b), "the products"),
    everyRow<{ id: string; name: string }>((a, b) => db.from("menus")
      .select("id, name").eq("restaurant_id", r.id).order("id").range(a, b), "the menus"),
    everyRow<TodayEntry>((a, b) => db.from("waste_entries")
      .select("id, name, ingredient_id, quantity, reason, recorded_by, created_at, cost")
      .eq("restaurant_id", r.id).gte("created_at", startOfLocalDay(new Date(), timeZone).toISOString())
      .order("id").range(a, b), "today's waste"),
  ]);
  const links = await everyRowIn<{ product_id: string; addon_id: string }>(
    products.filter(p => !p.is_addon).map(p => p.id),
    (ids, a, b) => db.from("item_addons").select("product_id, addon_id")
      .in("product_id", ids).order("product_id").order("addon_id").range(a, b), "the products' extras",
  );

  const menuName = new Map(menus.map(m => [m.id, m.name]));
  const choices: WasteChoice[] = [
    ...ingredients.map(i => ({ kind: "ingredient" as const, id: i.id, label: i.name, unit: i.unit })),
    ...products.filter(p => !p.is_addon).map(p => ({
      kind: "product" as const, id: p.id, unit: "pza" as const, modifiers: p.modifiers ?? [],
      extras: products.filter(a => a.is_addon && links.some(link => link.product_id === p.id && link.addon_id === a.id))
        .map(a => ({ id: a.id, label: [a.emoji, a.name].filter(Boolean).join(" ") })),
      label: [p.emoji, p.name].filter(Boolean).join(" ") + (menus.length > 1 && p.menu_id ? ` · ${menuName.get(p.menu_id) ?? ""}` : ""),
    })),
  ].sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head"><Breadcrumb trail={crumbs} /></header>
        <WasteRecorder
          choices={choices}
          today={today
            .map(e => ({ ...e, quantity: Number(e.quantity), cost: canSeeCost && e.cost !== null ? Number(e.cost) : null }))
            .sort((a, b) => b.created_at.localeCompare(a.created_at))}
          canSeeCost={canSeeCost}
          currency={r.currency}
          timeZone={timeZone}
        />
      </div>
    </div>
  );
}
