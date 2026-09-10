import { redirect } from "next/navigation";
import { getMembership, TAKES_TABLE_ORDERS } from "@/lib/membership";
import { getPlan, allPlans } from "@/lib/plan-server";
import { can, cheapestWith } from "@/lib/plan";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadOrderingData } from "@/lib/ordering-data";
import TableOrderScreen from "@/components/dashboard/waiter/TableOrderScreen";
import PlanLock from "@/components/dashboard/plan/PlanLock";

export const dynamic = "force-dynamic";

/**
 * /dashboard/table-order — the waiter takes the order.
 *
 * The oldest act in the trade, and the one thing the app could not do: somebody
 * walks to a table and writes down what the people sitting at it want.
 * Everything around it already existed — the bill, the split, the discount that
 * needs a manager, taking cash at the table — and none of it was reachable,
 * because an order had to start on a diner's phone.
 *
 * The same menu the till uses, sold-out dishes and all: a waiter is standing in
 * front of somebody who just asked for one, and "it is not on my screen" is not
 * an answer where "we've run out" is.
 */
export default async function TableOrderPage() {
  const membership = await getMembership();
  if (!membership) redirect("/dashboard");
  if (!TAKES_TABLE_ORDERS(membership.role)) redirect("/dashboard/orders");

  const plan = await getPlan(membership.restaurant.id);
  if (!plan || !can(plan.limits, "waiterService")) {
    // Named, not merely locked: the screen says which tier carries it.
    const unlocks = cheapestWith(await allPlans(), "waiterService");
    return (
      <div className="tt-dash">
        <div className="container">
          <PlanLock feature="waiterService" unlocksWith={unlocks?.plan ?? "servicio"} />
        </div>
      </div>
    );
  }

  const data = await loadOrderingData(membership.restaurant.id, { includeSoldOut: true });
  if (!data.restaurant) redirect("/dashboard");

  // The tables the restaurant actually has. A waiter picks one; they never
  // invent a name, so every order can be found later by the label the
  // restaurant already uses for that table — on the board, on the bill, and in
  // the history search.
  const { data: tables } = await createAdminClient()
    .from("restaurant_tables")
    .select("id, label")
    .eq("restaurant_id", membership.restaurant.id)
    .order("label");

  return (
    <TableOrderScreen
      restaurant={data.restaurant}
      categories={data.categories}
      items={data.items}
      extras={data.extras}
      extrasByProduct={data.extrasByProduct}
      promos={data.promos}
      combos={data.combos}
      closedNow={data.closedNow}
      dietaryTags={data.dietaryTags}
      tables={(tables ?? []) as { id: string; label: string }[]}
    />
  );
}
