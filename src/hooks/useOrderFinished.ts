"use client";

import { useEffect, useState } from "react";

/** Cada cuánto se pregunta. El seguimiento abierto va más rápido; esto es el
 *  latido de fondo, para el botón que está en el menú. */
const EVERY_MS = 15_000;

/** Para el comensal el pedido se acaba cuando se lo entregan, o se cancela. */
const DONE = ["completed", "cancelled"];

/**
 * Si el pedido que este teléfono venía siguiendo ya terminó.
 *
 * El botón de "seguir mi pedido" se leía de localStorage una sola vez, al
 * montar, y nada volvía a mirarlo: la cocina marcaba el pedido entregado y el
 * botón seguía ahí, abriendo el seguimiento de algo que el comensal ya se
 * comió. Sólo desaparecía al recargar, y recargar no es algo que uno le pida a
 * quien está sentado en una mesa.
 *
 * Se pregunta al endpoint público del seguimiento, el mismo que usa la hoja: el
 * comensal no puede leer `orders` directamente —su RLS se lo impide y así debe
 * seguir— así que no hay realtime que valga por este lado.
 */
export function useOrderFinished(orderId: string | null): boolean {
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDone(false);
    if (!orderId) return;

    let alive = true;
    const read = async (): Promise<void> => {
      try {
        const res = await fetch(`/api/order-status?id=${orderId}`);
        if (!res.ok) return; // un 404 es un pedido borrado: lo dirá la próxima
        const order = (await res.json()) as { status?: string };
        if (alive && order.status && DONE.includes(order.status)) setDone(true);
      } catch {
        // Sin red: se vuelve a intentar en la siguiente vuelta.
      }
    };

    // Sólo con la pestaña a la vista, como el refresco del menú: un teléfono
    // en el bolsillo no tiene por qué estar preguntando, y el momento en que
    // el comensal vuelve a mirar es justo cuando importa que esté al día.
    const tick = () => {
      if (document.visibilityState === "visible") void read();
    };

    tick();
    const timer = setInterval(tick, EVERY_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [orderId]);

  return done;
}
