"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";

interface PendingAttemptProps {
  message: string;
  onDiscard?: () => void;
  busy?: boolean;
}

/** The request stays visible until sending it again tells us what happened. */
export default function PendingAttempt({ message, onDiscard, busy = false }: PendingAttemptProps) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  function discard(): void {
    if (busy) return;
    setConfirm(false);
    onDiscard?.();
  }
  return (
    <div className="tt-offline-banner" role="status">
      <p>{message}</p>
      {onDiscard && (confirm ? <>
        <p>{t("pending.discardWarning")}</p>
        <div className="tt-prodform-actions">
          <button type="button" className="tt-btn tt-btn-ghost" disabled={busy} onClick={discard}>{t("pending.discardConfirm")}</button>
          <button type="button" className="tt-btn tt-btn-ghost" disabled={busy} onClick={() => setConfirm(false)}>{t("common.cancel")}</button>
        </div>
      </> : <button type="button" className="tt-btn tt-btn-ghost" disabled={busy} onClick={() => setConfirm(true)}>{t("pending.discard")}</button>)}
    </div>
  );
}
