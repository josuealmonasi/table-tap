import { createHmac, timingSafeEqual } from "node:crypto";
import { isLocale, type Locale } from "@/lib/i18n";

interface DigestStop {
  restaurantId: string;
  userId: string;
  addressKey: string;
  version: string;
  locale: Locale;
}

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function sign(body: string): string {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("Digest stop link signing is unavailable");
  return createHmac("sha256", secret).update(`daily-digest-stop-v2|${body}`).digest("base64url");
}

export function digestStopToken({ restaurantId, userId, addressKey, version, locale }: DigestStop): string {
  const body = [restaurantId, userId, addressKey, version, locale].join(".");
  return `${body}.${sign(body)}`;
}

export function readDigestStopToken(raw: string | null): DigestStop | null {
  if (!raw || raw.length > 222) return null;
  const [restaurantId, userId, addressKey, version, locale, sig, ...rest] = raw.split(".");
  if (rest.length || !UUID.test(restaurantId) || !UUID.test(userId) || !/^[0-9a-f]{64}$/.test(addressKey)
    || (version !== "0" && !UUID.test(version)) || !isLocale(locale)
    || !/^[A-Za-z0-9_-]{43}$/.test(sig ?? "")) return null;
  const expected = sign(raw.slice(0, -(sig.length + 1)));
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? { restaurantId, userId, addressKey, version, locale } : null;
}
