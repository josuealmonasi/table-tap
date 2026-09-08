"use client";

import { useEffect, useState } from "react";

/** How often to see whether the connection has come back. */
const PROBE_MS = 8_000;

/**
 * A file that is always there, tiny, and needs no session to fetch.
 * `cache: "no-store"` so a probe cannot be answered by a cache and report a
 * connection nobody has.
 */
const PROBE_URL = "/manifest.webmanifest";

/**
 * Whether the app can actually reach the server.
 *
 * `navigator.onLine` is the browser's own answer and it is a blunt one: it says
 * true for a tablet joined to a router that has lost its uplink, which is the
 * commonest way a restaurant goes offline. So a failed request is what puts the
 * app in the offline state — the browser is never asked to confirm it.
 *
 * Which leaves getting back out. The `online` event fires when the DEVICE
 * rejoins a network, and in the uplink case it never fires at all: the tablet
 * never left the wifi. Relying on it meant the board sat behind an offline
 * banner with work in its pocket long after the connection returned — verified
 * by stopping the server, moving a ticket, and starting it again, where nothing
 * came back on its own. So while it believes it is offline, it asks.
 *
 * Starts optimistic on purpose. Rendering "sin conexión" for a frame on a
 * perfectly good connection teaches the floor to ignore the banner.
 */
export function useOnline(): { online: boolean; markOffline: () => void } {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    if (!navigator.onLine) setOnline(false);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  useEffect(() => {
    if (online) return; // nothing to find out
    let stop = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(PROBE_URL, { cache: "no-store" });
        if (!stop && res.ok) setOnline(true);
      } catch {
        // Still out. The next tick asks again.
      }
    }, PROBE_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [online]);

  return { online, markOffline: () => setOnline(false) };
}
