"use client";

import { useEffect, useState } from "react";

/** Fired when something that a badge counts has been dealt with. */
export const BADGES_CHANGED = "tt:badges-changed";

/**
 * Tell the nav its counts are stale.
 *
 * Call it after anything that changes what is waiting: an order moved along,
 * a request approved or refused, a new request raised. Without it a manager
 * approves the last thing in the queue and the badge sits there claiming
 * there is still work, for up to half a minute — which teaches people the
 * number is decorative.
 */
export function badgesChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(BADGES_CHANGED));
}

/**
 * What each section is waiting on, kept roughly current.
 *
 * Refreshed on a slow timer and whenever the tab comes back to the front —
 * the moment somebody returns from the floor is exactly when an approval may
 * have arrived. Deliberately not realtime: a count that is thirty seconds
 * stale costs nothing, and a socket per dashboard screen to move one integer
 * would be paying rather a lot for that.
 */
export function useBadges(): Record<string, number> {
  const [badges, setBadges] = useState<Record<string, number>>({});

  useEffect(() => {
    let active = true;

    const read = () => {
      fetch("/api/badges")
        .then(r => {
          // 403 means this person has no restaurant to count anything for — a
          // platform admin, who still gets the dashboard shell. Nothing will
          // change that before a reload, so stop asking rather than logging a
          // refusal every thirty seconds for as long as the tab is open.
          if (r.status === 403) {
            clearInterval(timer);
            return { badges: {} };
          }
          return r.ok ? r.json() : { badges: {} };
        })
        .then((d: { badges?: Record<string, number> }) => {
          if (active) setBadges(d.badges ?? {});
        })
        .catch(() => {
          // A count we could not fetch is simply not shown.
        });
    };

    const timer = setInterval(read, 30_000);
    read();
    // Turning the setting off should clear them now, not in half a minute:
    // a switch that appears to do nothing gets flipped again.
    window.addEventListener(BADGES_CHANGED, read);
    const onVisible = () => {
      if (document.visibilityState === "visible") read();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(BADGES_CHANGED, read);
    };
  }, []);

  return badges;
}
