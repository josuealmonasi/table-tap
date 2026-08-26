/**
 * ¿Está en pie lo que vamos a revisar?
 *
 * Sin esto, un servidor caído produce una pared de errores por pantalla —
 * ERR_CONNECTION_REFUSED cien veces— que se lee como si la app estuviera rota.
 * Pasó varias veces en una tarde: el servidor de desarrollo se infla con las
 * horas (lo vimos en 1.4 GB) y se cae a media revisión. Un rojo confuso enseña
 * a ignorar los rojos, y entonces el de verdad pasa desapercibido.
 */
export async function reachable(base) {
  try {
    const res = await fetch(`${base}/login`, { signal: AbortSignal.timeout(10_000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function requireServer(base, prod) {
  if (await reachable(base)) return;
  console.error(
    `\n  El servidor no responde en ${base}.\n` +
      (prod
        ? "  Revisa el despliegue antes de leer nada de lo de abajo.\n"
        : "  Levántalo con `pnpm dev`. Si lleva horas encendido, mátalo y vuelve\n" +
          "  a empezar: en desarrollo se infla y se cae a media revisión.\n"),
  );
  process.exit(1);
}

/**
 * Un fetch que no confunde un servidor caído con una prueba fallida.
 *
 * El de desarrollo se cae a media revisión —se infla con las horas, y a veces
 * lo revive un `pnpm dev` que sigue vivo detrás— y el ECONNRESET salía por
 * pantalla como si el permiso o la ruta estuvieran mal. Un rojo que no es
 * verdad cuesta más que uno que sí: enseña a desconfiar de todos.
 *
 * Reintenta una vez, y si a la segunda tampoco hay servidor lo dice con esas
 * palabras en vez de dejar el error de red crudo.
 */
export async function retryFetch(url, init, base) {
  try {
    return await fetch(url, init);
  } catch (first) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      return await fetch(url, init);
    } catch {
      const up = base ? await reachable(base) : false;
      throw new Error(
        up
          ? `la petición falló dos veces (${first.message})`
          : "el servidor se cayó a media revisión — levántalo y vuelve a correr",
      );
    }
  }
}
