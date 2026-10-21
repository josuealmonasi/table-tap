import { Suspense } from "react";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import OrderingApp from "@/components/customer/OrderingApp";
import MenuSkeleton from "@/components/customer/MenuSkeleton";
import { menuShowsLoyalty, loadCoverState, loadOrderingData, unwrap } from "@/lib/ordering-data";
import { can } from "@/lib/plan";
import { getPlan } from "@/lib/plan-server";
import type { RestaurantTable } from "@/lib/types";
import { offerAt } from "@/lib/loyalty/pass";
import { openSittingAt } from "@/lib/table-membership";

export const dynamic = "force-dynamic";

/** The menu itself. Split out so the shell can render while this loads. */
async function Menu({
  restaurantId,
  tableId,
}: {
  restaurantId: string;
  tableId: string;
}) {
  // Read with the secret key, scoped to both ids in the URL. Tables are not
  // readable with the publishable key on purpose — listable table ids would let
  // anyone see any table's bill, or charge an order to it — so the QR code the
  // diner scanned names the table; only approved membership opens its bill.
  const [data, tableRes, plan] = await Promise.all([
    loadOrderingData(restaurantId),
    createAdminClient()
      .from("restaurant_tables")
      .select("*")
      .eq("id", tableId)
      .eq("restaurant_id", restaurantId)
      .single(),
    getPlan(restaurantId),
  ]);

  // An unknown table id is fine — the menu still works, the order just isn't
  // tagged. A failed lookup is not fine: it would drop the tag silently and
  // the food would reach the pass with no table to run it to, so unwrap throws.
  const table = unwrap<RestaurantTable>(tableRes, "table");

  // Dine-in is what the paid tiers are for, so a restaurant that stops paying
  // stops getting it — otherwise a trial could build twenty tables, lapse, and
  // run the paid product for free forever.
  //
  // The QR keeps working: it falls back to the counter menu, so the diner
  // holding the phone still sees the food, still orders and still pays. What
  // goes is the table — the open bill, paying at the end, calling the waiter.
  // Nothing breaks for the person who scanned it; the restaurant feels exactly
  // what it stopped paying for.
  const dineIn = plan ? can(plan.limits, "dineIn") : true;

  // Reached only when the restaurant genuinely doesn't exist; a transient
  // fault has already thrown, rather than telling the customer their QR code
  // points at nothing.
  if (!data.restaurant) notFound();
  const seatedAt = dineIn ? table : null;
  // Whether a party is eating here decides the visit card's pass: an empty
  // table offers it before ordering, somebody else's meal only after the phone
  // is let in. A failed read is treated as somebody's meal: no pass, menu intact.
  const sitting = seatedAt ? await openSittingAt(restaurantId, seatedAt.id).catch(() => "unknown") : null;

  return (
    <OrderingApp
      restaurant={data.restaurant}
      table={seatedAt}
      categories={data.categories}
      items={data.items}
      extras={data.extras}
      extrasByProduct={data.extrasByProduct}
      combos={data.combos}
      promos={data.promos}
      ratings={data.ratings}
      closedNow={data.closedNow}
      orderAtRegister={data.orderAtRegister}
      receipts={data.receipts}
      loyalty={seatedAt && data.loyalty ? (sitting ? { ...data.loyalty, pass: "" } : offerAt(data.loyalty, { table: seatedAt.id })) : data.loyalty}
      dietaryTags={data.dietaryTags}
    />
  );
}

// /r/[restaurantId]/t/[tableId] — the page a table QR points to. Same menu as
// the fast-food route, but the order is tagged with this table.
//
// The cover state is fetched first so the skeleton reserves the right height;
// see the note on the fast-food route.
export default async function TablePage({
  params,
}: {
  params: Promise<{ restaurantId: string; tableId: string }>;
}) {
  const { restaurantId, tableId } = await params;
  const [{ exists, cover }, loyalty] = await Promise.all([
    loadCoverState(restaurantId),
    menuShowsLoyalty(restaurantId),
  ]);
  if (!exists) notFound();

  return (
    <Suspense fallback={<MenuSkeleton table cover={cover} loyalty={loyalty} />}>
      <Menu restaurantId={restaurantId} tableId={tableId} />
    </Suspense>
  );
}
