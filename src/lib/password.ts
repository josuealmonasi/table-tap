/**
 * How short a password may be.
 *
 * One number, in one place, because it was three: a platform admin creating a
 * staff login was held to eight characters, and the owner signing up — the
 * account that holds the Stripe connection, the staff list, the settings and
 * the money — was held to six. The weakest door decides what a lock is worth,
 * and that door was the one behind everything.
 *
 * Eight is Supabase's own recommendation and what the rest of the app already
 * asked for. Length is the only rule here on purpose: composition rules push
 * people towards `Password1!` and away from the long passphrase that is
 * actually harder to guess.
 */
export const PASSWORD_MIN = 8;

/** Long enough to be accepted, or not. */
export function passwordTooShort(value: unknown): boolean {
  return typeof value !== "string" || value.length < PASSWORD_MIN;
}
