"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Un respiro tras el aviso: cerrar una mesa toca varios pedidos de golpe y no
 *  hace falta re-renderizar una vez por cada uno. */
const SETTLE_MS = 400;

/**
 * Mantiene al día una pantalla cuyos números salen de los pedidos.
 *
 * "Libre" y "Debe MX$…" no son columnas: se calculan en el servidor a partir
 * de lo que sigue sin pagarse. Esas pantallas se pintaban una vez y ahí se
 * quedaban — el mesero cobraba la Mesa 3 y el dueño, mirando Mesas y QR, seguía
 * viendo que debía, o veía un importe que ya no era. La única forma de
 * enterarse era recargar.
 *
 * El aviso llega por realtime y lo único que hace es pedirle al servidor que
 * vuelva a pintar. Rehacer la cuenta en el navegador sería un segundo lugar
 * donde vive la misma regla, y de esos ya hemos tenido bastantes: así el número
 * lo sigue calculando quien siempre lo calculó.
 *
 * También al volver a la pestaña, que es cuando alguien va a actuar sobre lo
 * que ve, y por si algún aviso se perdió mientras no miraba.
 */
export function useLiveOrders(restaurantId: string): void {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const bump = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), SETTLE_MS);
    };

    void (async () => {
      // Los pedidos son del equipo bajo RLS, así que el socket tiene que
      // llevar su token o no llega ni un cambio.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) supabase.realtime.setAuth(session.access_token);

      channel = supabase
        .channel(`live-orders-${restaurantId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "orders",
            filter: `restaurant_id=eq.${restaurantId}`,
          },
          bump,
        )
        .subscribe();
    })();

    const onVisible = (): void => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      if (channel) supabase.removeChannel(channel);
    };
  }, [restaurantId, router]);
}
