import { type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { qrSvg } from "@/lib/qr";
import { fetchTrackedOrder } from "@/lib/order-tracking";

export const dynamic = "force-dynamic";

/**
 * GET /api/order-qr?id=<orderId> — the code a diner shows to be charged.
 *
 * Its own route rather than a field on /api/order-status, which the tracker
 * polls every five seconds: the image never changes for a given order, so
 * sending it with every poll would be two kilobytes of the same SVG a
 * thousand times a service. Here the browser caches it once.
 *
 * It encodes the STAFF link, not the diner's. Whoever scans it is standing
 * behind a till: their phone should land on the bill, ready to collect, and a
 * generic camera app gets them there without our own scanner. A stranger who
 * scans it reaches a login — the route is staff-gated and scoped to its
 * restaurant, so the id in the code buys nothing the diner's own URL did not
 * already contain.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return await apiError("apiErr.missingId", 400);

  // The unguessable id is the trust boundary, same as the tracker's — but a
  // public route still gets a ceiling. Lower than order-status because this
  // one is fetched once and then cached, not polled.
  if (await isRateLimited(`order-qr:${clientIp(req)}`, 30, 60)) {
    return await apiError("apiErr.tooManyRequests", 429);
  }

  // Through the tracker's own reader, so an id that is not a real order gets
  // the same answer here as everywhere else rather than minting a code for it.
  const order = await fetchTrackedOrder(id);
  if (!order) return await apiError("apiErr.notFound", 404);

  const origin = req.nextUrl.origin;
  const svg = await qrSvg(`${origin}/dashboard/bills?order=${order.id}`);

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      // Immutable for the order's lifetime, and private: it belongs to one
      // diner's screen and has no business in a shared cache.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
