"use client";

import { useCardEmail, useCardRead } from "@/hooks/useCardEmail";
import { useT } from "@/lib/i18n/context";
import TicketEmailChoice from "./TicketEmailChoice.react-component";

interface BillTicketEmailProps {
  tableId?: string | null;
  orderId?: string | null;
  active: boolean;
  code?: string | null;
  skip: boolean;
  onSkip: (skip: boolean) => void;
  disabled?: boolean;
}
interface BillCard { card: { suffix?: string; code?: string; email?: string | null } | null }
async function read(url: string): Promise<BillCard> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error("Could not read bill card");
  return res.json();
}

/** Read this bill afresh, including a card changed on another staff screen. */
export default function BillTicketEmail({ tableId, orderId, active, skip, onSkip, disabled, code }: BillTicketEmailProps) {
  const t = useT();
  const query = tableId ? `tableId=${encodeURIComponent(tableId)}` : `orderId=${encodeURIComponent(orderId ?? "")}`;
  const { data, error } = useCardRead(active ? `/api/loyalty/attach?${query}` : null, read, 10_000);
  const scanned = code && (!data?.card?.suffix || code.endsWith(data.card.suffix)) ? code : null;
  const contact = useCardEmail(data?.card ? data.card.code || scanned : null);
  const email = contact.data ? contact.data.email : data?.card?.email;
  if (!active) return null;
  if (email) return <TicketEmailChoice email={email} skip={skip} onSkip={onSkip} disabled={disabled} />;
  if (!data || error || contact.error || (data.card && email === undefined)) return <div>
    <p className="tt-muted" role="status">{t(!data && !error ? "common.loading" : "cardEmail.readFailed")}</p>
    <label className="tt-check"><input type="checkbox" checked={skip} onChange={e => onSkip(e.target.checked)} disabled={disabled} />{t("cardEmail.skip")}</label>
  </div>;
  return null;
}
