"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]):not(:disabled)';

/**
 * A full-screen sheet behaves as the dialog it is: the dish, the cart, a
 * combo, the till's charge. Focus moves in when it opens and back when it
 * closes, Tab stays inside, and Escape closes it.
 *
 * Only the topmost dialog answers a key, so the coupon dialog over the cart
 * closes alone. On a phone the sheet covered the screen and nothing said a
 * dialog had opened: a screen reader read the menu behind it, and Tab walked
 * into that menu.
 */
export function useOverlayDialog(panel: RefObject<HTMLElement | null>, onClose: () => void): void {
  // Callers pass a new arrow on every render. Read it through a ref so the
  // effect runs once per opening and never pulls focus back mid-typing.
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const sheet = panel.current;
    if (!sheet) return;
    const previous = document.activeElement as HTMLElement | null;
    // A field that asked for focus keeps it (the till's name box). Otherwise
    // the first button, never a field, so a phone doesn't raise its keyboard.
    if (!sheet.contains(document.activeElement)) {
      const first = sheet.querySelector<HTMLElement>("button:not(:disabled), a[href]");
      (first ?? sheet).focus({ preventScroll: true });
    }

    const topmost = (): boolean => {
      const open = document.querySelectorAll('[aria-modal="true"]');
      return open[open.length - 1] === sheet;
    };

    function onKey(e: KeyboardEvent): void {
      if (e.defaultPrevented || !sheet || !topmost()) return;
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        el => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!sheet.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [panel]);
}
