// The address a diner linked to their visit card, to receive every ticket by
// email (owner's request, 2026-11-11: paperless). Used for tickets and nothing
// else; consent is recorded with the notice version it was given under.
import { createAdminClient } from "@/lib/supabase/admin";
import { TERMS_VERSION } from "@/lib/legal";
import { newToken, tokenHash } from "@/lib/digest-recipients";

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
  | { outcome: "submitted"; token: string }
  | { outcome: "pending" | "removed" | "unknown" | "forbidden" };

type CardEmailAuthority = { restaurantId: string; actor: string } | { ownerHash: string; restaurantId?: string };

/**
 * Link, replace or remove a card's address, inside one restaurant. A new
 * address gets a new "stop" link secret, so an old email's link cannot remove
 * the new one. Each card may use the same address independently.
 */
export async function setCardEmail(code: string, email: string | null, authority: CardEmailAuthority): Promise<SetEmailResult> {
  const token = email ? newToken() : null;
  const { data, error } = await createAdminClient().rpc("set_card_email_v2", {
    p_restaurant: authority.restaurantId ?? null, p_code: code, p_email: email, p_notice: TERMS_VERSION,
    p_actor: "actor" in authority ? authority.actor : null,
    p_owner_hash: "ownerHash" in authority ? authority.ownerHash : null,
    p_token_hash: token ? tokenHash(token) : null,
  });
  if (error) throw new Error(`Could not save the card's email: ${error.message}`);
  if (data === "saved" && email) return { outcome: "saved", email };
  if (data === "submitted" && token) return { outcome: "submitted", token };
  if (data === "pending" || data === "removed" || data === "unknown" || data === "forbidden") return { outcome: data };
  throw new Error("Unexpected card email result");
}

export function cardEmailPending(expiresAt: string | null | undefined): boolean {
  return Boolean(expiresAt && Date.parse(expiresAt) > Date.now());
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
