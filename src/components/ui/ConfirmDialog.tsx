"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useT } from "@/lib/i18n/context";

/** Basic options for a confirm/cancel dialog. */
export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

/** Opens the dialog and resolves true (confirm) or false (cancel/dismiss). */
type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** Hook used by callers: `if (await confirm({ ... })) doTheThing()`. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used inside a <ConfirmProvider>");
  return ctx;
}

/**
 * Provides a promise-based confirm() to its subtree and renders a single shared
 * dialog. The promise resolves based on which button the user clicks (or false
 * on Escape / backdrop), so calling code simply acts on the boolean result.
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((result: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>(opts => {
    // A newer question cancels the older one; no caller can be left waiting.
    resolverRef.current?.(false);
    setOptions(opts);
    return new Promise<boolean>(resolve => {
      resolverRef.current = resolve;
    });
  }, []);

  useEffect(() => () => {
    resolverRef.current?.(false);
    resolverRef.current = null;
  }, []);

  const resolve = useCallback((result: boolean) => {
    resolverRef.current?.(result);
    resolverRef.current = null;
    setOptions(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && <Dialog options={options} onResolve={resolve} />}
    </ConfirmContext.Provider>
  );
}

function Dialog({
  options,
  onResolve,
}: {
  options: ConfirmOptions;
  onResolve: (result: boolean) => void;
}) {
  const t = useT();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Escape cancels. This question owns focus while its parent modal waits.
  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const buttons = () => [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    // A destructive question starts on the safe answer; any other starts on
    // its action, as it always did, so Enter still confirms a harmless one.
    const start = buttons();
    (options.danger ? start[0] : start[start.length - 1])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onResolve(false);
      }
      if (e.key !== "Tab") return;
      e.stopPropagation();
      const items = buttons();
      const first = items[0];
      const last = items[items.length - 1];
      if (!dialog?.contains(document.activeElement) || (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first)?.focus();
      }
    };
    const containFocus = (e: FocusEvent) => {
      if (!dialog?.contains(e.target as Node)) buttons()[0]?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("focusin", containFocus);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("focusin", containFocus);
      if (previous?.isConnected) previous.focus();
    };
  }, [onResolve, options.danger]);

  return (
    <div className="tt-dialog-overlay" style={{ zIndex: 110 }} onClick={() => onResolve(false)}>
      <div
        ref={dialogRef}
        className="tt-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={options.title}
        onClick={e => e.stopPropagation()}
      >
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {options.title}
        </h3>
        {options.message && (
          <p className="tt-muted" style={{ marginTop: 8 }}>
            {options.message}
          </p>
        )}
        <div className="tt-dialog-actions">
          <button className="tt-btn tt-btn-ghost" onClick={() => onResolve(false)}>
            {options.cancelLabel ?? t("common.cancel")}
          </button>
          <button
            className={`tt-btn ${options.danger ? "tt-btn-danger" : "tt-btn-primary"}`}
            onClick={() => onResolve(true)}
          >
            {options.confirmLabel ?? t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
