// ============================================================================
// The visit pass: what proves a new visit card was asked for from inside the
// restaurant.
//
// SERVER-ONLY: signed with the secret key. A card is worth nothing until staff
// stamp it, but making one used to need nothing but the restaurant's id, which
// is printed on every QR — anyone could fill an owner's program with cards
// nobody carries, and its numbers with visits that never began. Now the page
// that offers the card (a table's menu, the counter menu, an order's tracker)
// is handed a pass when the server renders it, and the card route takes only
// a pass it signed, for that restaurant, still within one sitting's length.
//
// Each pass makes one card. A phone remembers the card it made and is not
// offered another, so a diner sees one offer per visit; what stops somebody
// reloading for more is the ceiling on each place (`PLACE_CEILING`), counted
// by the route. The phone's own identifier is not used: it is chosen by the
// phone, so it would bound nothing, and the privacy notice gives it one use.
// ============================================================================
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { OPEN_BILL_HOURS } from "@/lib/table-bill";
import { MAX_SHARES } from "@/lib/split-shares";
import { PHONES_PER_ADDRESS } from "@/lib/rate-limit";

/** Where a card was offered: a table, an order's tracker, or the counter menu. */
export type VisitPlace = { table: string } | { order: string } | "counter";

/** A pass lasts as long as a sitting can: a page left open all evening still works. */
export const PASS_SECONDS = OPEN_BILL_HOURS * 3600;

/**
 * How many cards one place makes within `PASS_SECONDS`.
 *
 * A table or an order is one party, and twenty is the largest party the app
 * knows (a bill divides at most `MAX_SHARES` ways). The counter is the whole
 * room, so it is counted by the hour: two a minute, every minute, is more than
 * any queue moves.
 */
export const PLACE_CEILING = { party: MAX_SHARES, counterPerHour: PHONES_PER_ADDRESS * 4 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIG_LENGTH = 22;

function placeKey(place: VisitPlace): string {
  if (place === "counter") return "menu";
  return "table" in place ? `t-${place.table}` : `o-${place.order}`;
}

function placeOf(key: string): VisitPlace | null {
  if (key === "menu") return "counter";
  const id = key.slice(2);
  if (!UUID.test(id)) return null;
  if (key.startsWith("t-")) return { table: id };
  if (key.startsWith("o-")) return { order: id };
  return null;
}

/** Null without a secret: a pass signed with an empty key is one anybody can make. */
function sign(restaurantId: string, rest: string): string | null {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return null;
  return createHmac("sha256", secret)
    .update(`visit-pass|${restaurantId}|${rest}`)
    .digest("base64url")
    .slice(0, SIG_LENGTH);
}

/** A pass for a page about to offer the card. Empty when the server cannot sign. */
export function issueVisitPass(restaurantId: string, place: VisitPlace, now = Date.now()): string {
  const rest = `${placeKey(place)}.${Math.floor(now / 1000).toString(36)}.${randomBytes(9).toString("base64url")}`;
  const sig = sign(restaurantId, rest);
  return sig ? `${rest}.${sig}` : "";
}

export interface VisitPass {
  place: VisitPlace;
  /** Names this pass and nothing else; the route spends it once. */
  nonce: string;
}

/**
 * The pass, if this server signed it for this restaurant and it is still
 * within a sitting's length. Anything else — a guess, another restaurant's,
 * one from yesterday, one from the future — is null.
 */
export function readVisitPass(restaurantId: string, pass: unknown, now = Date.now()): VisitPass | null {
  if (typeof pass !== "string" || pass.length > 120) return null;
  const parts = pass.split(".");
  if (parts.length !== 4) return null;
  const [key, issued36, nonce, sig] = parts;
  const expected = sign(restaurantId, `${key}.${issued36}.${nonce}`);
  if (!expected || sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  const age = Math.floor(now / 1000) - parseInt(issued36, 36);
  // A minute of grace for two servers whose clocks disagree.
  if (!Number.isFinite(age) || age < -60 || age > PASS_SECONDS) return null;
  const place = placeOf(key);
  return place ? { place, nonce } : null;
}

/** The rate-limit bucket for a place, and its ceiling within `windowSeconds`. */
export function placeLimit(restaurantId: string, place: VisitPlace): { bucket: string; limit: number; windowSeconds: number } {
  const bucket = `loyalty-card:${restaurantId}:${placeKey(place)}`;
  return place === "counter"
    ? { bucket, limit: PLACE_CEILING.counterPerHour, windowSeconds: 3600 }
    : { bucket, limit: PLACE_CEILING.party, windowSeconds: PASS_SECONDS };
}

/** The offer, with a pass for the page it is shown on. */
export function offerAt<T extends { restaurantId: string; pass: string }>(offer: T | null, place: VisitPlace): T | null {
  return offer && { ...offer, pass: issueVisitPass(offer.restaurantId, place) };
}
