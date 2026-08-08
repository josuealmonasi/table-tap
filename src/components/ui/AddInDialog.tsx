"use client";

import { useState, type ReactNode } from "react";
import { Modal } from "./Modal";

interface AddInDialogProps {
  /** Trigger button text, e.g. "+ Add table". */
  label: string;
  /** Dialog heading, e.g. "New table". */
  title: string;
  maxWidth?: number;
  /** The form. Call `close` once the save succeeds. */
  children: (close: () => void) => ReactNode;
}

/**
 * A trigger button that opens a create form in a dialog.
 *
 * The dashboard used to park create forms open above their lists, so a page
 * led with an empty form instead of the things that already exist — and
 * creating followed a different pattern from editing on the same screen. This
 * is that pattern in one place, so the next list added to the dashboard gets
 * it for free rather than inventing an eighth variation.
 */
export default function AddInDialog({
  label,
  title,
  maxWidth = 640,
  children,
}: AddInDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="tt-promo-add">
        <button className="tt-btn tt-btn-primary tt-btn-sm" onClick={() => setOpen(true)}>
          {label}
        </button>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        maxWidth={maxWidth}
        title={title}
      >
        {children(() => setOpen(false))}
      </Modal>
    </>
  );
}
