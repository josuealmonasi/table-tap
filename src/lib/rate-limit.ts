import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Shared, DB-backed rate limiting for the public (anon-callable) API routes.
// Backed by the rate_limits table + rate_limit_hit() so it works across
// serverless instances, using the secret key. It fails OPEN: if the limiter
// itself errors we let the request through rather than block a real customer.

/** Best-effort caller IP from the proxy headers (falls back to a shared bucket). */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Records a hit for `bucket` and reports whether it now exceeds `limit` within
 * the rolling `windowSeconds`. Returns false (allow) on any limiter error.
 */
export async function isRateLimited(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc("rate_limit_hit", {
      p_bucket: bucket,
      p_window_seconds: windowSeconds,
    });
    if (error) return false;
    return typeof data === "number" && data > limit;
  } catch {
    return false;
  }
}
