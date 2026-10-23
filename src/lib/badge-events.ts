/** An action changed what the navigation counts as waiting. */
export const BADGES_CHANGED = "tt:badges-changed";

export function badgesChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(BADGES_CHANGED));
}
