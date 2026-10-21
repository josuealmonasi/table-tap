"use client";
import { useState } from "react";
import { useOfflineSales } from "@/hooks/useOfflineSales";
import { useT } from "@/lib/i18n/context";

interface Props { restaurantId: string }

/** Mount even when selling is locked, so the last receipt can leave the tablet. */
export default function UploadHeldSales({ restaurantId }: Props) {
  const t = useT();
  const offline = useOfflineSales(restaurantId, true);
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try { await offline.flush(); } finally { setBusy(false); }
  }
  return <section className="tt-section" aria-label={t("recovery.send")}>
    <p>{t("recovery.uploadOnly")}</p>
    {offline.held.length ? <>
      <p role="status">{t("recovery.local", { count: offline.held.length })}</p>
      {offline.held.map(s => s.error && <p key={s.posRef} role="alert">{s.error}</p>)}
      <button className="tt-btn tt-btn-primary" disabled={busy || !offline.online} onClick={send}>{t("recovery.send")}</button>
    </> : <p role="status">{t("recovery.uploaded")}</p>}
  </section>;
}
