/**
 * What this app is allowed to load, and where it may talk to.
 *
 * There was no real Content-Security-Policy for a long time, deliberately: a
 * half-written one either blocks checkout or lulls somebody into thinking the
 * app has one. This is the piece of work that was owed, written against what
 * the app actually fetches rather than against a template.
 *
 * The shape of the app makes a strict one affordable. Scripts are Next's own,
 * loaded from our origin; the fonts are self-hosted by `next/font`; Stripe
 * Checkout is a full-page redirect rather than an embedded frame, and
 * `@stripe/stripe-js` is never imported; the only other host the browser talks
 * to is Supabase, for data, for realtime and for the menu photography.
 *
 * So the interesting directive is the last resort rather than the first:
 * `connect-src`. An injected script that cannot reach a server it chose cannot
 * send anybody's bill anywhere.
 */

/** Where the data, the realtime socket and the dish photographs come from. */
const SUPABASE = "https://*.supabase.co";
const SUPABASE_SOCKET = "wss://*.supabase.co";

/** Development only: the hot reloader, and whatever the editor is running. */
const LOOPBACK = [
  "ws://localhost:*",
  "http://localhost:*",
  "ws://127.0.0.1:*",
  "http://127.0.0.1:*",
].join(" ");

/**
 * Vercel's preview toolbar, which is how this repo's pull requests are
 * commented on. It is a real production build, so it needs none of the
 * development allowances — only its own host, and only on a preview.
 */
const PREVIEW_TOOLBAR = "https://vercel.live";

/**
 * @param nonce   a fresh value per request; Next stamps it on its own scripts
 * @param dev     the development server, which needs `eval` and a websocket
 *                for hot reload and serves over plain http
 * @param preview a deployment for a pull request, where the toolbar lives
 */
export function contentSecurityPolicy(nonce: string, dev: boolean, preview = false): string {
  const directives: string[] = [
    "default-src 'self'",

    // `strict-dynamic` is what makes a nonce worth having: a browser that
    // understands it ignores the host list entirely and trusts only the script
    // we stamped and whatever that script loads — which is exactly Next's
    // bootstrap and its own chunks. Older Safari ignores it and falls back to
    // `'self'` plus the nonce, which also works.
    //
    // `unsafe-eval` in development only. The hot reloader needs it; production
    // does not, and a policy that carries it in production is not a policy.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}${
      preview ? " " + PREVIEW_TOOLBAR : ""
    }`,

    // Inline styles are unavoidable and, unlike scripts, cheap: the app styles
    // elements with React's `style` attribute throughout, and a nonce cannot
    // apply to an attribute. The print windows carry their own `<style>` too.
    "style-src 'self' 'unsafe-inline'",

    // `data:` for inline icons, `blob:` for a file the browser made itself.
    `img-src 'self' data: blob: ${SUPABASE}`,
    "font-src 'self' data:",

    // The one that matters. Nowhere but us and our database — so a script that
    // somehow ran has no address to send a bill to.
    // In development the loopback address is spelled both ways — hot reload
    // uses one and an editor's console bridge the other — and a host in a
    // policy is matched literally, so `localhost` does not cover `127.0.0.1`.
    `connect-src 'self' ${SUPABASE} ${SUPABASE_SOCKET}${dev ? " " + LOOPBACK : ""}${
      preview ? " " + PREVIEW_TOOLBAR + " wss://ws-us3.pusher.com" : ""
    }`,

    "media-src 'self' blob:",
    // The kitchen board's offline worker.
    "worker-src 'self' blob:",
    "manifest-src 'self'",

    // Nothing is embedded and nothing embeds us. The dashboard settles bills
    // and writes off tables; a page that can frame it can put its own buttons
    // over ours and let a signed-in manager click them.
    "object-src 'none'",
    `frame-src ${preview ? PREVIEW_TOOLBAR : "'none'"}`,
    "frame-ancestors 'none'",

    // A `<base>` somebody injected rewrites every relative URL on the page,
    // including the ones that post money.
    "base-uri 'none'",
    "form-action 'self'",
  ];

  // Not in development, where the server is plain http and this would send
  // every request to a port nothing is listening on.
  if (!dev) directives.push("upgrade-insecure-requests");

  return directives.join("; ");
}
