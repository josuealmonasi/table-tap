import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ¿Esta mesa es de este restaurante?
 *
 * Las rutas públicas reciben `restaurantId` y `tableId` del cuerpo de la
 * petición, y hasta ahora sólo /api/service-requests comprobaba que fueran
 * pareja. Sin la comprobación se puede crear un pedido en el restaurante A
 * etiquetado con una mesa del restaurante B: filas cruzadas, una sentada
 * abierta en la mesa de alguien más y, como sólo puede haber una sentada
 * abierta por mesa, los comensales reales de B acaban metidos en la sentada
 * que abrió A.
 *
 * Devuelve la mesa cuando son pareja, o null.
 */
export async function tableOf(
  restaurantId: string,
  tableId: string,
): Promise<{ id: string; label: string } | null> {
  const { data } = await createAdminClient()
    .from("restaurant_tables")
    .select("id, label")
    .eq("id", tableId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  return (data as { id: string; label: string } | null) ?? null;
}
