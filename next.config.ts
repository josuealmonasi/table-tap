import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
