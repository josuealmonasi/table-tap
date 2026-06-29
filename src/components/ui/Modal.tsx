"use client";

import { useEffect } from "react";

/**
 * Generic modal shell, reusing the same overlay/dialog look as ConfirmDialog
 * but hosting arbitrary content (e.g. a form) instead of a fixed message.
 * Closes on Escape or backdrop click.
 */
export function Modal({
  open,
  onClose,
  children,
  maxWidth = 640,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="tt-dialog-overlay" onClick={onClose}>
      <div
        className="tt-dialog tt-modal"
        style={{ maxWidth }}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
