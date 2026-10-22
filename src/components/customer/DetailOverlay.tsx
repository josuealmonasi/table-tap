"use client";

import { useRef, type ReactNode } from "react";
import { useOverlayDialog } from "@/hooks/useOverlayDialog";

interface DetailOverlayProps {
  onClose: () => void;
  /** What a screen reader announces when it opens: the dish, "Your order"… */
  label: string;
  /** The cart's wider panel. */
  wide?: boolean;
  /** Replaces the panel's look, for a sheet with its own (the till's charge). */
  panelClassName?: string;
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
 *
 * Layered over the menu, it is a dialog, and says so (`useOverlayDialog`).
 */
export default function DetailOverlay({
  onClose,
  label,
  wide = false,
  panelClassName,
  children,
}: DetailOverlayProps) {
  const panel = useRef<HTMLDivElement>(null);
  useOverlayDialog(panel, onClose);
  return (
    <div className="tt-detail-overlay" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={panelClassName ?? (wide ? "tt-detail-panel tt-detail-panel-wide" : "tt-detail-panel")}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
