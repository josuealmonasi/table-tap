import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";

/**
 * Compare in constant time.
 *
 * Belt and braces, and worth being honest about which: the row was already
 * found with `.eq("print_token", …)`, so Postgres matched it exactly and this
 * can only ever agree. It is here so that a later refactor which loosens that
 * lookup — a prefix, a join, a cache — does not quietly turn the comparison
 * into a byte-by-byte one that answers faster the closer a guess gets.
 *
 * The length check returns early because `timingSafeEqual` throws on unequal
 * lengths. That does leak the length, which is fine: every token this issues
 * is the same 43 characters, so the length tells an attacker nothing they
 * could not read off the format.
 */
function tokenMatches(given: string, actual: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface Printer {
  restaurantId: string;
  name: string;
  timeZone: string;
}

/**
 * Resolve the token to the restaurant that owns it, or nothing.
 *
 * The lookup is by token, so an attacker cannot ask about a restaurant they
 * name — they can only present a secret and be told nothing if it is wrong.
 */
export async function printerForToken(token: string): Promise<Printer | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("restaurants")
    .select("id, name, timezone, print_token")
    .eq("print_token", token)
    .maybeSingle();
  if (!data?.print_token) return null;
  if (!tokenMatches(token, data.print_token as string)) return null;

  return {
    restaurantId: data.id as string,
    name: (data.name as string) ?? "",
    timeZone: (data.timezone as string) ?? DEFAULT_TIME_ZONE,
  };
}

