// ============================================================================
// What this phone remembers about a restaurant's visit card.
//
// Either the card it made — so it is never offered a second one — or that the
// diner said "don't ask again". Per restaurant, in this browser only: nothing
// here leaves the phone, and a diner who clears their browser is simply
// offered a card again, which is the promise the offer makes.
//
// Storage can be blocked (private mode, a strict browser) and every access is
// wrapped: a phone that cannot remember is offered the card, never broken.
// ============================================================================

export type DeviceCard = { code: string } | { declined: true } | null;

const key = (restaurantId: string) => `tt-loyalty:${restaurantId}`;

export function readDeviceCard(restaurantId: string): DeviceCard {
  try {
    const raw = window.localStorage.getItem(key(restaurantId));
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === "object") {
      if ("code" in value && typeof value.code === "string") return { code: value.code };
      if ("declined" in value && value.declined === true) return { declined: true };
    }
    return null;
  } catch {
    return null;
  }
}

export function rememberCard(restaurantId: string, code: string): void {
  try {
    window.localStorage.setItem(key(restaurantId), JSON.stringify({ code }));
  } catch {
    // Not remembered: offered again next time, which is the honest failure.
  }
}

export function rememberDeclined(restaurantId: string): void {
  try {
    window.localStorage.setItem(key(restaurantId), JSON.stringify({ declined: true }));
  } catch {
    // As above.
  }
}

/** Whether to offer a card at all: nothing made here, and not told no. */
export function shouldOffer(restaurantId: string): boolean {
  return readDeviceCard(restaurantId) === null;
}
