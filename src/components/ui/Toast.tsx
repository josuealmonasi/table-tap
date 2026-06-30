"use client";

import { createContext, useCallback, useContext, useState } from "react";

type Tone = "error" | "info";
type ToastItem = { id: number; message: string; tone: Tone };
type ToastFn = (message: string, tone?: Tone) => void;

const ToastContext = createContext<ToastFn>(() => {});

/** Show a transient message: `const toast = useToast(); toast("Saved"); toast("Failed", "error")`. */
export function useToast(): ToastFn {
  return useContext(ToastContext);
}

/** Renders a stack of auto-dismissing toasts and provides useToast() to its subtree. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback<ToastFn>((message, tone = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toasts.length > 0 && (
        <div className="tt-toasts" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`tt-toast ${t.tone === "error" ? "tt-toast-error" : ""}`}>
              {t.message}
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
