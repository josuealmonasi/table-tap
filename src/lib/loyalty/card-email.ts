// The address a diner linked to their visit card, to receive every ticket by
// email (owner's request, 2026-11-11: paperless). Used for tickets and nothing
// else; consent is recorded with the notice version it was given under.
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
  | { outcome: "unknown" };

/**
 * Link, replace or remove a card's address, inside one restaurant. A new
 * address gets a new "stop" link secret, so an old email's link cannot remove
 * the new one. Each card may use the same address independently.
 */
export async function setCardEmail(restaurantId: string, code: string, email: string | null, setBy: string): Promise<SetEmailResult> {
  const db = createAdminClient();
  const { data, error } = await db.rpc("set_card_email", {
    p_restaurant: restaurantId, p_code: code, p_email: email, p_set_by: setBy, p_notice: TERMS_VERSION,
  });
  if (error) throw new Error(`Could not save the card's email: ${error.message}`);
  if (!data) return { outcome: "unknown" };
  return email ? { outcome: "saved", email } : { outcome: "removed" };
}

/** The card's address as this role may see it: full for owner and manager, masked for the floor. */
export function emailForRole(email: string | null, fullAccess: boolean): string | null {
  if (!email) return null;
  return fullAccess ? email : maskEmail(email);
}

/** A card's address as this reader may see it, or null when it has none. */
export async function cardEmailFor(restaurantId: string, cardId: string, fullAccess: boolean): Promise<string | null> {
  const { data } = await createAdminClient().from("loyalty_cards").select("email")
    .eq("restaurant_id", restaurantId).eq("id", cardId).maybeSingle();
  return emailForRole((data?.email as string | null) ?? null, fullAccess);
}
