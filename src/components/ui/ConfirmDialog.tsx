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
    setOptions(opts);
    return new Promise<boolean>(resolve => {
      resolverRef.current = resolve;
    });
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

  // Escape cancels.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onResolve(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onResolve]);

  return (
    <div className="tt-dialog-overlay" onClick={() => onResolve(false)}>
      <div
        className="tt-dialog"
        role="dialog"
        aria-modal="true"
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
            autoFocus
          >
            {options.confirmLabel ?? t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
