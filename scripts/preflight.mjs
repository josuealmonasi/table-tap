/**
 * Is the thing we are about to check actually up?
 *
 * Without this, a downed server produces a wall of one error per screen —
 * ERR_CONNECTION_REFUSED a hundred times — that reads as though the app were
 * broken. It happened several times in one afternoon: the dev server bloats
 * over the hours (we saw 1.4 GB) and drops mid-run. A confusing red teaches
 * people to ignore reds, and then the real one goes unnoticed.
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
        ? "  Check the deployment before reading anything below.\n"
        : "  Start it with `pnpm dev`. If it has been up for hours, kill it and\n" +
          "  start over: in development it bloats and drops mid-run.\n"),
  );
  process.exit(1);
}

/**
 * A fetch that does not mistake a downed server for a failed test.
 *
 * The dev one drops mid-run — it bloats over the hours, and sometimes a
 * `pnpm dev` still alive behind it revives it — and the ECONNRESET came out
 * on screen as though the permission or the route were wrong. A red that is
 * not true costs more than one that is: it teaches distrust of all of them.
 *
 * Retries once, and if there is still no server on the second try it says so
 * in those words instead of leaving the raw network error.
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
