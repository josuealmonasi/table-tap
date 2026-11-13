import type { NextConfig } from "next";

// The gate runner builds with live updates off to spare the dev database
// (src/lib/supabase/live-updates.ts). A deployed build must never: the boards
// would stop updating with nothing on screen to say so.
if (process.env.VERCEL && process.env.NEXT_PUBLIC_GATE_LIVE_UPDATES === "off") {
  throw new Error("NEXT_PUBLIC_GATE_LIVE_UPDATES=off is for the gate build only; remove it from this Vercel environment.");
}

const nextConfig: NextConfig = {
  // The ticket's typefaces are read from disk by the routes that make the
  // PDF; tracing does not see a readFileSync path, so it is named here.
  // pdfkit reads its built-in font metrics (Helvetica.afm, loaded by every new
  // document) from beside its own files. Bundled, it looked for them beside
  // the chunk and every ticket PDF answered 503 in a production build while
  // the unit tests, which do not bundle, passed. Required from node_modules
  // instead, its data files are traced with it.
  serverExternalPackages: ["pdfkit"],
  outputFileTracingIncludes: {
    "/api/orders/print": ["./src/lib/fonts/**"],
    "/api/settings/ticket-preview": ["./src/lib/fonts/**"],
  },
  images: {
    // Menu photography lives in Supabase Storage. Only the project host is
    // allowed, so a stored URL can't be pointed at somewhere else to make our
    // optimiser fetch it.
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" }],
  },

  /**
   * Headers every response carries.
   *
   * Vercel already sends HSTS and nothing else, which left the one thing this
   * app cannot afford: the dashboard settles bills, approves refunds and
   * writes off tables, so a page that can put it in a frame can put its own
   * buttons on top and let a signed-in manager click them. Nothing here uses
   * an iframe and Stripe Checkout is a full-page redirect, so refusing to be
   * framed at all costs nothing.
   *
   * The Content-Security-Policy is NOT here. It carries a per-request nonce,
   * so it is written in `src/middleware.ts` from `src/lib/csp.ts`. What stays
   * here is everything that is the same on every response, including the
   * paths middleware does not run on.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // No framing. The modern half of this is `frame-ancestors` in the
          // policy the middleware writes; this covers the static files it does
          // not run on, and the browsers that still prefer it.
          { key: "X-Frame-Options", value: "DENY" },
          // A stored file is served as what it says it is, never as what the
          // browser guesses from its bytes.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // An order URL names an order. Off-site requests get the origin and
          // not the path it was reading.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Asked for and refused up front — except the camera, which this
          // app genuinely uses: a cashier scans a diner's bill code and a
          // waiter scans the code on a table. `camera=()` is an EMPTY list,
          // which refuses our own page as well, and it did: the scanner
          // shipped and could never open a lens. `(self)` is us and nobody
          // else, including anything we ever embed.
          //
          // `payment` is deliberately absent from the list. Checkout is a
          // full-page redirect today, so denying it would change nothing —
          // but the day somebody puts Apple Pay on our own page, a header
          // nobody remembers writing is a bad way to find out. Money is the
          // one thing that does not get a speculative restriction.
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(), usb=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
