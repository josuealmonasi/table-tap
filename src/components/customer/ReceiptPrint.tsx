"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { ReceiptVersion } from "@/lib/receipt";
import { useT } from "@/lib/i18n/context";
import { printWhenReady } from "@/lib/print-window";

interface ReceiptPrintProps {
  orderIds?: string[]; paymentId?: string; disabled: boolean;
  issued?: RefObject<{ version?: ReceiptVersion }>;
}

export default function ReceiptPrint({ orderIds = [], paymentId, disabled, issued }: ReceiptPrintProps) {
  const t = useT();
  const target = paymentId ?? orderIds.join(",");
  const ownVersion = useRef<{ target: string; version?: ReceiptVersion }>({ target });
  if (ownVersion.current.target !== target) ownVersion.current = { target };
  const copy = issued ?? ownVersion;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ controller: AbortController; popup: Window } | null>(null);
  useEffect(() => () => { request.current?.controller.abort(); request.current?.popup.close(); }, []);

  async function print(): Promise<void> {
    if (request.current) return;
    setError("");
    // Open during the click: opening after the read is blocked on phones.
    const popup = window.open("", "_blank", "width=380,height=640");
    if (!popup) { setError(t("receiptPrint.blocked")); return; }
    popup.opener = null;
    const controller = new AbortController();
    request.current = { controller, popup };
    setBusy(true);
    const issuedCopy = copy.current;
    try {
      const response = await fetch("/api/receipt", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds, paymentId, delivery: "print", version: issuedCopy.version }), signal: controller.signal,
      });
      const data = await response.json();
      if (controller.signal.aborted || popup.closed) return;
      if (!response.ok || typeof data.html !== "string") throw new Error("Could not read receipt");
      // Reprint the copy that opened, rather than silently adding a later loss.
      if (data.version) issuedCopy.version = data.version;
      popup.document.write(data.html);
      popup.document.close();
      popup.focus();
      printWhenReady(popup);
    } catch {
      popup.close();
      if (!controller.signal.aborted) setError(t("receiptPrint.failed"));
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <>
    <button type="button" className="tt-btn tt-btn-secondary" style={{ width: "100%", marginTop: 8 }}
      disabled={disabled || busy} onClick={() => void print()}>{t(busy ? "receiptPrint.loading" : "receiptPrint.action")}</button>
    <p className="tt-muted" style={{ fontSize: 13 }}>{t("receiptPrint.hint")}</p>
    {error && <p className="tt-receipt-error" role="alert">{error}</p>}
  </>;
}
