import { createHmac, timingSafeEqual } from "node:crypto";
import { isLocale, type Locale } from "@/lib/i18n";

function sign(body: string): string {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("Digest stop link signing is unavailable");
  return createHmac("sha256", secret).update(`daily-digest-stop-v1|${body}`).digest("base64url");
}

export function digestStopToken(userId: string, locale: Locale): string {
  const body = `${userId}.${locale}`;
  return `${body}.${sign(body)}`;
}

export function readDigestStopToken(raw: string | null): { userId: string; locale: Locale } | null {
  if (!raw || raw.length !== 83) return null;
  const [userId, locale, sig] = raw.split(".");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(userId) || !isLocale(locale)
    || !/^[A-Za-z0-9_-]{43}$/.test(sig ?? "")) return null;
  const expected = sign(`${userId}.${locale}`);
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? { userId, locale } : null;
}
