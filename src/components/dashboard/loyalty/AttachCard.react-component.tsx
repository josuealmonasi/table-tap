"use client";

import { useState } from "react";
import useSWR from "swr";
import { useT } from "@/lib/i18n/context";
import QrScanner from "@/components/dashboard/QrScanner";
import { codeFromScan, normalizeCode } from "@/lib/loyalty/code";
import type { AttachedCard } from "@/lib/loyalty/attachment";

export interface SelectedCard extends AttachedCard { code: string }
interface AttachCardProps {
  active: boolean;
  target: { restaurantId?: string; orderId?: string; sessionId?: string; tableId?: string; preview?: boolean };
  disabled?: boolean;
  deviceCode?: string;
  selection?: SelectedCard | null;
  onSelection?: (card: SelectedCard | null) => void;
  onBusy?: (busy: boolean) => void;
}
interface Availability { enabled: boolean; card: AttachedCard | null }
const read = async (url: string): Promise<Availability> => {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Could not read loyalty availability");
    return await res.json();
  } catch { throw new Error("Could not read loyalty availability"); }
};

/** One selector for the till, the floor and the diner's saved bearer card. */
export default function AttachCard({ active, target, disabled = false, deviceCode, selection, onSelection, onBusy }: AttachCardProps) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = new URLSearchParams(Object.entries(target).map(([key, value]) => [key, String(value)])).toString();
  const { data, error: readError, mutate } = useSWR(active ? `/api/loyalty/attach?${query}` : null, read, { refreshInterval: 10_000 });
  const card = target.preview ? selection : data?.card;

  async function attach(code: string | null, remove = false): Promise<void> {
    if (busy || disabled) return;
    if (remove && target.preview) { onSelection?.(null); return; }
    setBusy(true); onBusy?.(true); setError(null);
    try {
      const res = await fetch("/api/loyalty/attach", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...target, code, remove }),
      });
      const result = await res.json();
      if (!res.ok) { setError(result.error ?? t("apiErr.generic")); return; }
      if (target.preview) onSelection?.(result.card ? { ...result.card, code: code! } : null);
      else await mutate({ enabled: true, card: result.card }, { revalidate: true });
      setTyped("");
    } catch { setError(t("done.networkError")); }
    finally { setBusy(false); onBusy?.(false); }
  }

  if (active && readError) return <p role="alert" className="tt-field-error">{t("done.networkError")}</p>;
  if (!active || !data?.enabled) return null;
  const code = normalizeCode(typed);
  return <fieldset disabled={busy || disabled} style={{ border: 0, padding: 0, margin: "12px 0", minWidth: 0 }}>
    <legend>{t("loyaltyAttach.title")}</legend>
    {card && <p role="status">{t("loyaltyAttach.attached", { code: card.suffix, progress: card.progress, goal: card.goal })}</p>}
    {deviceCode ? <button type="button" className="tt-btn tt-btn-outline" onClick={() => void attach(deviceCode)}>{t("loyaltyAttach.use")}</button>
      : card ? <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => void attach(null, true)}>{t("loyaltyAttach.remove")}</button>
      : <>
        <div className="tt-stamp-type-row">
          <input className="tt-input tt-rewards-code" value={typed} onChange={e => setTyped(e.target.value)}
            aria-label={t("rewards.codeLabel")} autoComplete="off" spellCheck={false} />
          <button type="button" className="tt-btn tt-btn-ghost" disabled={!code} onClick={() => void attach(code)}>{t("loyaltyAttach.attach")}</button>
        </div>
        <QrScanner label={t("loyaltyAdmin.scan")} title={t("loyaltyAttach.title")} hint={t("loyaltyAdmin.scanning")}
          noCamera={t("loyalty.noCamera")} onRead={raw => {
            const found = codeFromScan(raw);
            if (!found) return "keep-looking";
            void attach(found); return "taken";
          }} />
      </>}
    <p className="tt-muted">{t("loyaltyAttach.hint")}</p>
    {error && <p className="tt-field-error" role="alert">{error}</p>}
  </fieldset>;
}
