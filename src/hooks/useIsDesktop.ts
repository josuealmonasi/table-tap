"use client";

import { useEffect, useState } from "react";

/** The width the customer screens switch layout at, shared with the CSS. */
const DESKTOP = "(min-width: 1025px)";

/**
 * Whether this is a wide screen, kept in step with the CSS breakpoint.
 *
 * Starts false so the server and the first client render agree — a phone is
 * the safe assumption, and a wide screen corrects itself on the same tick the
 * page becomes interactive. It keeps listening, so a resize (or turning a
 * tablet) moves the layout with it instead of stranding it.
 */
export function useIsDesktop(): boolean {
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    setWide(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setWide(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return wide;
}
