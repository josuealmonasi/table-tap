"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { codeFromScan, normalizeCode } from "@/lib/loyalty/code";
import CardEmail from "@/components/loyalty/CardEmail.react-component";
import QrScanner from "../QrScanner";

interface AttachedCardEmailProps {
  suffix: string;
  code?: string | null;
  email?: string | null;
  disabled: boolean;
  onCode?: (code: string) => void;
}

/** A bill gives only the suffix. Scan the card again to edit without publishing its bearer code. */
export default function AttachedCardEmail({ suffix, code, email, disabled, onCode }: AttachedCardEmailProps) {
  const t = useT();
  const [scanning, setScanning] = useState(false);
  const [typed, setTyped] = useState("");
  const [found, setFound] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const known = code || found;
  function selectCode(value: string): void {
    if (disabled) return;
    const normal = normalizeCode(value);
    if (!normal || !normal.endsWith(suffix)) { setError(true); return; }
    setFound(normal); setError(false); onCode?.(normal);
  }
  if (known) return <CardEmail key={known} code={known} disabled={disabled} />;
  return <div>
    <p style={{ overflowWrap: "anywhere" }}>{email === undefined ? t("cardEmail.scanToRead") : email || t("cardEmail.none")}</p>
    <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" disabled={disabled} onClick={() => setScanning(s => !s)}>{t("cardEmail.edit")}</button>
    {scanning && <>
      <label className="tt-field"><span>{t("rewards.codeLabel")}</span><input className="tt-input" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" /></label>
      <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" disabled={disabled || !normalizeCode(typed)} onClick={() => selectCode(typed)}>{t("rewards.check")}</button>
      <QrScanner label={t("loyaltyAdmin.scan")} title={t("cardEmail.title")} hint={t("loyaltyAdmin.scanning")}
        noCamera={t("loyalty.noCamera")} onRead={raw => {
          if (disabled) return "keep-looking";
          const normal = codeFromScan(raw);
          if (!normal) return "keep-looking";
          selectCode(normal); return "taken";
        }} />
    </>}
    {error && <p role="alert" className="tt-field-error">{t("cardEmail.differentCard", { suffix })}</p>}
  </div>;
}
