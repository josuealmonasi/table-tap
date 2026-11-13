/**
 * Whether this build's screens subscribe to realtime row changes.
 *
 * Always on, except in the build the gate runner serves, which sets
 * `NEXT_PUBLIC_GATE_LIVE_UPDATES=off`. The browser gates open hundreds of
 * screens as every role; each one joined a channel, and realtime's poll of the
 * change stream was the largest single consumer of the dev database: 4,211 s
 * and ~1.2 GB of temp-file I/O in eight days, plus a subscription written and
 * deleted per visit (gate-db-io review, 2026-11-13). No browser gate waits for
 * a live update — every visit is a fresh navigation and readiness ignores
 * websockets — and `pnpm rls` asks the socket its questions directly, so
 * nothing they check depends on it.
 *
 * `next.config.ts` refuses to build with it off on Vercel, so production
 * always subscribes.
 */
export function liveUpdatesEnabled(): boolean {
  // Spelled out in full: Next inlines NEXT_PUBLIC_* only when written literally.
  return process.env.NEXT_PUBLIC_GATE_LIVE_UPDATES !== "off";
}
