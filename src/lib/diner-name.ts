/**
 * The name this diner gave at the counter, kept on their own phone.
 *
 * They are asked for it once and then remembered, because ordering a drink
 * after your food should not mean typing your name again — and because a
 * second order under a different spelling is two names for one person at the
 * same counter.
 *
 * Per restaurant, and only ever on their device: it is their own name, sitting
 * beside the order ids this phone already keeps, and the privacy notice says
 * so. Never sent anywhere except with an order they place.
 */
const KEY = (restaurantId: string) => `tt-name:${restaurantId}`;

/** How long a name is worth remembering: one visit, not forever. */
export const NAME_TTL_MS = 6 * 60 * 60 * 1000;

interface Remembered {
  name: string;
  at: number;
}

export function rememberDinerName(restaurantId: string, name: string): void {
  try {
    const trimmed = name.trim();
    if (!trimmed) return;
    const value: Remembered = { name: trimmed, at: Date.now() };
    localStorage.setItem(KEY(restaurantId), JSON.stringify(value));
  } catch {
    // Storage off: they will simply be asked again, which is the old behaviour.
  }
}

/**
 * Their name, if they gave one recently enough for it still to be theirs.
 *
 * Expiring matters on a shared phone and on a device left on a counter: a name
 * from last week prefilled into somebody else's order is worse than an empty
 * field.
 */
export function recallDinerName(restaurantId: string, now = Date.now()): string {
  try {
    const raw = localStorage.getItem(KEY(restaurantId));
    if (!raw) return "";
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return "";
    const { name, at } = parsed as Partial<Remembered>;
    if (typeof name !== "string" || typeof at !== "number") return "";
    if (now - at > NAME_TTL_MS) {
      localStorage.removeItem(KEY(restaurantId));
      return "";
    }
    return name;
  } catch {
    return "";
  }
}
