import { execSync } from "node:child_process";

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
  watchDevWorker(base);
  if (await reachable(base)) return;
  console.error(
    `\n  The server does not answer at ${base}.\n` +
      (prod
        ? "  Check the deployment before reading anything below.\n"
        : "  Start it with `pnpm dev`. If it has been up for hours, kill it and\n" +
          "  start over: in development it bloats and drops mid-run.\n"),
  );
  process.exit(1);
}

/**
 * Stop a gate that writes before it gets anywhere near production.
 *
 * Production is somebody's real accounting: a probe order or payment shows up
 * in their takings and in the corte, and a switch flipped on the live
 * restaurant stays flipped if the run dies halfway. The refusal exits 1, so a
 * gate that checked nothing never reads as a pass in a chain of `&&`.
 */
export function refuseProduction(gate, why) {
  if (!process.argv.includes("--prod")) return;
  console.error(
    `\n  ${gate} is not run against production: ${why}.\n` +
      "  What reads the deployed site: smoke:prod, roles:prod, layout:prod, dialogs:prod,\n" +
      "  money:prod, rls:audit:prod, and the sweeps of promises:prod.\n",
  );
  process.exit(1);
}

/**
 * Compile the routes a sweep is about to open, before it opens them.
 *
 * In development Next compiles a route the first time anything asks for it,
 * and a cold route can take well over the 30 seconds Playwright allows a
 * `goto`. The sweep then reports the page as unreachable — which reads as a
 * broken screen and is nothing of the sort. It has cost three full gate runs
 * and one wrong diagnosis.
 *
 * A plain fetch is enough to make Next build the route; nothing here cares
 * about the response. Failures are ignored on purpose: a path that 404s or
 * redirects still gets compiled, and whether it ANSWERS is the sweep's
 * question to ask, not this one's.
 */
export async function warm(base, paths) {
  const unique = [...new Set(paths)].filter(Boolean);
  for (const path of unique) {
    try {
      await fetch(base + path, { signal: AbortSignal.timeout(90_000) });
    } catch {
      // Cold, slow, missing or refused — the sweep will say so properly.
    }
  }
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
          ? `the request failed twice (${first.message})`
          : "the server died mid-sweep — start it and run again",
      );
    }
  }
}

/** The pids of the dev server's workers, or null against anything but localhost. */
function devWorkers(base) {
  if (!/^http:\/\/localhost[:/]/.test(base)) return null;
  try {
    return execSync("pgrep -f next-server", { encoding: "utf8" }).trim().split("\n").sort().join(",") || null;
  } catch {
    return null; // pgrep exits 1 when nothing matches: no worker to watch
  }
}

/**
 * Says so when `next dev` replaced its worker while this gate ran.
 *
 * During a long sweep the dev server recycles its worker (`next-server`) when
 * it grows too big, and whatever was in flight at that moment fails: an
 * ECONNRESET in the RLS gate that left a fixture payment behind, so money went
 * red next; a button the promise sweep never saw render; an order detail the
 * layout gate could not open. Each read as a fault in the code, and each
 * passed when run again alone. Nothing in the output said the server had
 * moved underneath.
 *
 * Checked at exit, so it costs nothing while the gate runs. A run that failed
 * across a restart says so beside its failures; one that passed says it only
 * as a note.
 */
export function watchDevWorker(base) {
  const before = devWorkers(base);
  if (!before) return;
  process.on("exit", code => {
    const after = devWorkers(base);
    if (!after || after === before) return;
    console.log(
      `\n  The dev server replaced its worker during this run (pid ${before} -> ${after}).\n` +
        (code
          ? "  A failure above may be that restart, not the code: run this gate again, alone, before debugging it.\n"
          : "  Nothing failed across it.\n"),
    );
  });
}
