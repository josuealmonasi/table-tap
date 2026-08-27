import { createAdminClient } from "@/lib/supabase/admin";
import { MANAGES, OWNS, SETTLES } from "@/lib/membership";
import { requireSettles } from "@/lib/page-guard";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import BillsPanel from "@/components/dashboard/BillsPanel";
import UserLogs from "@/components/dashboard/staff/UserLogs";
import { openBills } from "@/lib/open-bills";
import type { Order } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * /dashboard/bills — every bill still open, so the floor can find one.
 *
 * A manager is asked for a discount by name of the table, not by order id, so
 * this lists tables and to-go orders with what they owe and lets them be
 * searched. The kitchen has no business here; everyone else on the floor does,
 * because a waiter can ask for a discount even though only a manager grants it.
 */
export default async function BillsPage() {
  const membership = await requireSettles();
  const r = membership.restaurant;

  // Read with the secret key: orders are unreadable to anyone but the team's
  // own policies, and this page needs every table's, not just one's.
  const db = createAdminClient();
  const [{ data: orders }, { data: requests }, { data: writeOffs }, { data: asking }] =
    await Promise.all([
    db
      .from("orders")
      .select(
        "id, table_id, table_label, items, total, discount, paid, written_off, status, coupon_code, created_at",
      )
      .eq("restaurant_id", r.id)
      .eq("paid", false)
      .neq("status", "pending_payment")
      .order("created_at", { ascending: false })
      .limit(200),
    db
      .from("discount_requests")
      .select("*")
      .eq("restaurant_id", r.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    db
      .from("write_off_requests")
      .select("*")
      .eq("restaurant_id", r.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
    // Quién pidió la cuenta: son las mesas que están esperando a que alguien
    // vaya a cobrarles, que no es lo mismo que tener saldo.
    db
      .from("service_requests")
      .select("table_id")
      .eq("restaurant_id", r.id)
      .in("kind", ["bill", "pay"])
      .eq("status", "open"),
  ]);

  return (
    <ConfirmProvider>
      <BillsPanel
        bills={openBills((orders ?? []) as Order[])}
        requests={MANAGES(membership.role) ? (requests ?? []) : []}
        writeOffs={MANAGES(membership.role) ? (writeOffs ?? []) : []}
        currency={r.currency}
        canApprove={MANAGES(membership.role)}
        restaurantId={r.id}
        canSettle={SETTLES(membership.role)}
        askedToPay={(asking ?? []).map(a => a.table_id).filter(Boolean) as string[]}
      >
        {/* Sólo el dueño, porque es lo único que la base deja leer: la política
            de `user_logs` es `owns_restaurant`. Enseñándosela al gerente, la
            reja decía que sí y la base devolvía cero — el gerente abría
            "Actividad reciente" con su buscador, sus botones de orden y la
            lista vacía, y se iba pensando que la bitácora no sirve.

            No se abre la política en vez de cerrar la reja: la bitácora también
            trae altas, bajas y cambios de rol del equipo, y el gerente no entra
            a /dashboard/staff. */}
        {OWNS(membership.role) && (
          <UserLogs restaurantId={r.id} currency={r.currency} />
        )}
      </BillsPanel>
    </ConfirmProvider>
  );
}
