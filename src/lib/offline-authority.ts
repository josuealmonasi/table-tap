import { createHmac, timingSafeEqual } from "node:crypto";

const WINDOW_MS = 12 * 60 * 60_000;
interface CollectorContext { restaurantId: string; collector: string; currency: string; issuedAt: number; until: number }

function signature(body: string): string | null {
  const secret = process.env.SUPABASE_SECRET_KEY;
  return secret ? createHmac("sha256", secret).update(`offline-collector-v1|${body}`).digest("base64url") : null;
}

/** Issued only while this staff member can open the online till. It proves
 * who the cached till belonged to; it never grants authority to choose prices. */
export function issueOfflineContext(restaurantId: string, collector: string, currency: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ restaurantId, collector, currency, issuedAt: now, until: now + WINDOW_MS })).toString("base64url");
  const sig = signature(body);
  return sig ? `${body}.${sig}` : "";
}

export function readOfflineContext(raw: unknown, restaurantId: string): CollectorContext | null {
  if (typeof raw !== "string" || raw.length > 2000) return null;
  const [body, sig, extra] = raw.split(".");
  const expected = signature(body ?? "");
  if (extra || !sig || !/^[A-Za-z0-9_-]+$/.test(sig) || !expected || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const value = JSON.parse(Buffer.from(body, "base64url").toString()) as CollectorContext;
    return value.restaurantId === restaurantId && typeof value.collector === "string" && value.collector.length <= 254
      && ["MXN", "USD"].includes(value.currency) && Number.isFinite(value.issuedAt) && value.until === value.issuedAt + WINDOW_MS ? value : null;
  } catch { return null; }
}

export function contextCoveredSale(context: CollectorContext, at: string): boolean {
  const time = Date.parse(at);
  return Number.isFinite(time) && time >= context.issuedAt - 5 * 60_000 && time <= context.until + 5 * 60_000;
}
