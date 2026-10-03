"use client";

import type { ReactNode } from "react";

interface DetailOverlayProps {
  onClose: () => void;
  /** The cart's wider panel. */
  wide?: boolean;
  children: ReactNode;
}

/**
 * A screen layered over the menu rather than replacing it — the dish detail,
 * a combo, the cart.
 *
 * Each used to replace the screen beneath outright. On a phone that is right
 * and looks identical, because the overlay is opaque and full-bleed; on a wide
 * screen it meant a full-page takeover for one dish, the customer losing their
 * place in the list, and a short form stretched across an empty page. Keeping
 * the menu mounted behind is both less jarring and a shorter trip back.
 */
export default function DetailOverlay({
  onClose,
  wide = false,
  children,
}: DetailOverlayProps) {
  return (
    <div className="tt-detail-overlay" onClick={onClose}>
      <div
        className={wide ? "tt-detail-panel tt-detail-panel-wide" : "tt-detail-panel"}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
