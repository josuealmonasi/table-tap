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
   * Deliberately NOT a Content-Security-Policy. A real one has to be tested
   * against Stripe, Supabase and the fonts before it can be trusted, and a
   * half-written CSP either blocks checkout or lulls somebody into thinking
   * the app has one. That is its own piece of work.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // No framing, by either the old header or the modern one. Both,
          // because browsers disagree about which they honour.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          // A stored file is served as what it says it is, never as what the
          // browser guesses from its bytes.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // An order URL names an order. Off-site requests get the origin and
          // not the path it was reading.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // The menu needs none of these. Asked for and refused up front.
          //
          // `payment` is deliberately absent from the list. Checkout is a
          // full-page redirect today, so denying it would change nothing —
          // but the day somebody puts Apple Pay on our own page, a header
          // nobody remembers writing is a bad way to find out. Money is the
          // one thing that does not get a speculative restriction.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), usb=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
