// The address a diner linked to their visit card, to receive every ticket by
// email (owner's request, 2026-11-11: paperless). Used for tickets and nothing
// else; consent is recorded with the notice version it was given under.
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { TERMS_VERSION } from "@/lib/legal";

/** Lower-cased and trimmed, or null when it is not an address. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

/** "j***@hotmail.com": what a waiter or cashier sees. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 1)}***@${domain}`;
}

export type SetEmailResult =
  | { outcome: "saved"; email: string }
  | { outcome: "removed" }
  | { outcome: "taken"; suffix: string }
  | { outcome: "unknown" };

/**
 * Link, replace or remove a card's address, inside one restaurant. A new
 * address gets a new "stop" link secret, so an old email's link cannot remove
 * the new one. An address already on another card of this restaurant is
 * refused with that card's last four, so staff can use that card instead.
 */
export async function setCardEmail(restaurantId: string, code: string, email: string | null, setBy: string): Promise<SetEmailResult> {
  const db = createAdminClient();
  const patch = email
    ? { email, email_consent_at: new Date().toISOString(), email_notice_version: TERMS_VERSION, email_set_by: setBy, email_unsubscribe: randomUUID() }
    : { email: null, email_consent_at: null, email_notice_version: null, email_set_by: null, email_unsubscribe: null };
  const { data, error } = await db.from("loyalty_cards").update(patch)
    .eq("restaurant_id", restaurantId).eq("code", code).select("id").maybeSingle();
  if (error?.code === "23505" && email) {
    const { data: other } = await db.from("loyalty_cards").select("code")
      .eq("restaurant_id", restaurantId).eq("email", email).maybeSingle();
    return { outcome: "taken", suffix: String(other?.code ?? "").slice(-4) };
  }
  if (error) throw new Error(`Could not save the card's email: ${error.message}`);
  if (!data) return { outcome: "unknown" };
  return email ? { outcome: "saved", email } : { outcome: "removed" };
}

/** The card's address as this role may see it: full for owner and manager, masked for the floor. */
export function emailForRole(email: string | null, fullAccess: boolean): string | null {
  if (!email) return null;
  return fullAccess ? email : maskEmail(email);
}
