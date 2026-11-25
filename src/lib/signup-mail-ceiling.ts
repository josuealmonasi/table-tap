import { createHmac } from "node:crypto";
import { isRateLimited } from "@/lib/rate-limit";

/** At most one signup or confirmation email per address in this window. */
export const SIGNUP_MAIL_COOLDOWN_SECONDS = 600;
/** And at most this many in a day, across signup and resend together. */
export const SIGNUP_MAILS_PER_DAY = 3;
const DAY_SECONDS = 86_400;

/**
 * The counter key for one destination inbox: a keyed hash of the normalized
 * address, so the rate_limits row never holds the email itself and cannot be
 * turned back into it without the server's secret.
 */
export function signupMailKey(normalizedEmail: string): string {
  return createHmac("sha256", process.env.SUPABASE_SECRET_KEY ?? "")
    .update(`signup-mail|${normalizedEmail}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Whether this address has had all the signup mail it may get for now.
 *
 * The per-network-address limits on /api/signup and /api/signup/resend bound
 * how fast one caller asks, not how much one inbox receives: a stranger could
 * make somebody else's inbox receive repeated mail. Both routes share this
 * ceiling, and the caller answers its usual 200 body when it is reached, so
 * the response says nothing about the address. The day is only counted when
 * the cooldown lets a mail through, so refused requests do not eat it.
 */
export async function isSignupMailCapped(normalizedEmail: string): Promise<boolean> {
  const key = signupMailKey(normalizedEmail);
  if (await isRateLimited(`signup-mail-10m:${key}`, 1, SIGNUP_MAIL_COOLDOWN_SECONDS)) return true;
  return isRateLimited(`signup-mail-day:${key}`, SIGNUP_MAILS_PER_DAY, DAY_SECONDS);
}
