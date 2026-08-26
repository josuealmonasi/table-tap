import { createAdminClient } from "@/lib/supabase/admin";
import { orderCode, type Order } from "@/lib/types";
import { slipFor } from "@/lib/printing";

/**
 * Pone una comanda en la cola de cada impresora activa del restaurante.
 *
 * Se llama cuando el pedido llega a la cocina de verdad — al confirmarse el
 * pago, o al hacerlo si se paga al final— y nunca antes: una hoja de un pedido
 * que todavía puede no pagarse es comida que alguien empieza a preparar por
 * nada.
 *
 * Falla en silencio a propósito. Si la impresión revienta, el pedido ya está
 * hecho y la pantalla lo muestra igual; tumbar el checkout porque una impresora
 * no responde sería cambiar una molestia por una venta perdida.
 */
export async function queueSlips(order: Order): Promise<number> {
  try {
    const db = createAdminClient();
    const { data: printers } = await db
      .from("printers")
      .select("id")
      .eq("restaurant_id", order.restaurant_id)
      .eq("active", true);

    if (!printers?.length) return 0;

    const body = slipFor(order, orderCode(order.id));
    const { error } = await db.from("print_jobs").upsert(
      printers.map(p => ({
        restaurant_id: order.restaurant_id,
        printer_id: p.id,
        order_id: order.id,
        body,
      })),
      // El mismo pedido no se encola dos veces para la misma impresora: el
      // webhook de Stripe puede llegar repetido y eso es normal.
      { onConflict: "order_id,printer_id", ignoreDuplicates: true },
    );
    return error ? 0 : printers.length;
  } catch {
    return 0;
  }
}
