"use client";

import { useT } from "@/lib/i18n/context";
import type { PosSaleDetails } from "@/hooks/usePosSaleDetails";
import TicketEmailChoice from "@/components/loyalty/TicketEmailChoice.react-component";

interface PosCardEmailProps { details: PosSaleDetails; busy: boolean; canEmailReceipt: boolean }
export default function PosCardEmail({ details: d, busy, canEmailReceipt }: PosCardEmailProps) {
  const t = useT();
  if (!canEmailReceipt) return null;
  return <>
    {d.cardEmail ? <TicketEmailChoice email={d.cardEmail} skip={d.skipTicketEmail || d.noTicket} onSkip={d.setSkipTicketEmail} disabled={busy || d.noTicket} /> : d.loyaltyCard && d.cardEmail === undefined ? <div>
      <p className="tt-muted" role="status">{t(d.cardEmailError ? "cardEmail.readFailed" : "common.loading")}</p>
      <label className="tt-check"><input type="checkbox" checked={d.skipTicketEmail || d.noTicket} disabled={busy || d.noTicket} onChange={e => d.setSkipTicketEmail(e.target.checked)} />{t("cardEmail.skip")}</label>
    </div> : null}
    {d.cardEmail === null && d.loyaltyCard && d.email.trim() && !d.noTicket && <>
      <label className="tt-check"><input type="checkbox" checked={d.saveCardEmail} disabled={busy} onChange={e => { d.setSaveCardEmail(e.target.checked); d.setEmailConsent(false); }} />{t("cardEmail.saveOnCard")}</label>
      {d.saveCardEmail && <label className="tt-check"><input type="checkbox" checked={d.emailConsent} disabled={busy} onChange={e => d.setEmailConsent(e.target.checked)} />{t("cardEmail.staffConsent")}</label>}
    </>}
  </>;
}
