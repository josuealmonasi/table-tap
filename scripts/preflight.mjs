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
