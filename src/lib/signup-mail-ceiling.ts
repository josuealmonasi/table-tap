import { createHmac } from "node:crypto";
import { canonicalInbox } from "@/lib/canonical-inbox";
import { isRateLimited } from "@/lib/rate-limit";

/** At most one mail of a kind per inbox in this window. */
export const SIGNUP_MAIL_COOLDOWN_SECONDS = 600;
/** And at most this many of that kind in a day (signup and resend count together). */
export const SIGNUP_MAILS_PER_DAY = 3;
const DAY_SECONDS = 86_400;

/** Each kind of unsolicited mail has its own budget per inbox. */
export type InboxMailKind = "signup-mail" | "password-reset";

/**
 * The counter key for one destination inbox: a keyed hash of its canonical
 * form (`canonicalInbox`), so every spelling of one mailbox shares a counter,
 * and the rate_limits row never holds the email itself and cannot be turned
 * back into it without the server's secret.
 */
export function inboxMailKey(kind: InboxMailKind, email: string): string {
  return createHmac("sha256", process.env.SUPABASE_SECRET_KEY ?? "")
    .update(`${kind}|${canonicalInbox(email)}`)
    .digest("hex")
    .slice(0, 32);
}

export function signupMailKey(email: string): string {
  return inboxMailKey("signup-mail", email);
}

/**
 * Whether this inbox has had all the mail of this kind it may get for now.
 *
 * Per-network-address limits bound how fast one caller asks, not how much one
 * inbox receives: a stranger could make somebody else's inbox receive repeated
 * mail. The caller answers its usual 200 body when the ceiling is reached, so
 * the response says nothing about the address. The day is only counted when
 * the cooldown lets a mail through, so refused requests do not eat it.
 */
export async function isInboxMailCapped(kind: InboxMailKind, email: string): Promise<boolean> {
  const key = inboxMailKey(kind, email);
  if (await isRateLimited(`${kind}-10m:${key}`, 1, SIGNUP_MAIL_COOLDOWN_SECONDS)) return true;
  return isRateLimited(`${kind}-day:${key}`, SIGNUP_MAILS_PER_DAY, DAY_SECONDS);
}

/** Shared by /api/signup and /api/signup/resend. */
export function isSignupMailCapped(email: string): Promise<boolean> {
  return isInboxMailCapped("signup-mail", email);
}
