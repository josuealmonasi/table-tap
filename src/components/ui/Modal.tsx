"use client";

import { DirtyCloseContext, type CloseGuard } from "@/hooks/useDirtyClose";
import { useContext, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ModalRecoveryContext } from "./ModalRecovery";

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]):not(:disabled)';

/**
 * Generic modal shell, reusing the same overlay/dialog look as ConfirmDialog
 * but hosting arbitrary content (e.g. a form) instead of a fixed message.
 *
 * Closes on Escape or backdrop click. While open it moves focus inside, keeps
 * Tab within the dialog, and hands focus back to whatever opened it — without
 * that, a keyboard or screen-reader user tabs straight into the page behind
 * and never learns the dialog is there.
 */
export function Modal({
  open,
  onClose,
  children,
  maxWidth = 640,
  label,
  title,
  variant = "center",
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
  /** Accessible name announced when the dialog opens. */
  label?: string;
  /** Visible heading, e.g. "Editing Beef Tacos". Also names the dialog for
   *  screen readers when no explicit `label` is given. */
  title?: string;
  /**
   * "sheet" rises from the bottom edge instead of sitting in the middle. On a
   * phone that puts the controls under the thumb rather than at the top of the
   * screen, and it keeps the list behind it visible so the filters read as a
   * change to that list rather than a separate place you've been taken to.
   */
  variant?: "center" | "sheet";
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const recovery = useContext(ModalRecoveryContext);
  const guard: CloseGuard = useRef<CloseGuard["current"]>(null);
  const closing = useRef(false);
  async function requestClose(): Promise<void> {
    if (closing.current) return;
    closing.current = true;
    try {
      if (!guard.current || await guard.current()) onCloseRef.current();
    } finally { closing.current = false; }
  }
  const requestCloseRef = useRef(requestClose);
  useLayoutEffect(() => { requestCloseRef.current = requestClose; });
  // The latest onClose, read when a key is pressed. It used to be a dependency
  // of the effect below, and callers pass a new arrow on every render — so
  // every keystroke in a form inside the dialog re-ran the effect, which moved
  // focus back to the first field: one character, then the cursor jumped to
  // the email box. Focus moves in when the dialog OPENS, and only then.
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Prefer the first real control; fall back to the dialog itself.
    const first = dialog?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? dialog)?.focus();

    function onKey(e: KeyboardEvent) {
      if (closing.current || guard.confirming || e.defaultPrevented) return;
      if (e.key === "Escape") {
        void requestCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        el => el.offsetParent !== null,
      );
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      // Wrap at both ends so focus can't escape to the page behind.
      if (!dialog.contains(document.activeElement)) {
        e.preventDefault();
        (e.shiftKey ? lastEl : firstEl).focus();
      } else if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  const overlay = (
    <div
      className={`tt-dialog-overlay ${variant === "sheet" ? "tt-overlay-sheet" : ""}`}
      onClick={() => void requestClose()}
    >
      <div
        ref={dialogRef}
        className={`tt-dialog tt-modal ${variant === "sheet" ? "tt-sheet" : ""}`}
        style={{ maxWidth }}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? title}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
      >
        {title && <h3 className="tt-modal-title">{title}</h3>}
        {recovery?.notice}
        <DirtyCloseContext.Provider value={guard}>
          {recovery ? <fieldset disabled={recovery.blocked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>{children}</fieldset> : children}
        </DirtyCloseContext.Provider>
      </div>
    </div>
  );
  // Stay outside the editor's disabled fieldset even before a read fails.
  // Keeping the portal and fieldset in place preserves the mounted draft.
  return recovery ? createPortal(overlay, document.body) : overlay;
}
