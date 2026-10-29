import { createHash, timingSafeEqual } from "node:crypto";

export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  // Equal-sized hashes keep both unequal lengths and unequal bytes out of
  // string comparisons that stop at the first matching secret character.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`));
}
