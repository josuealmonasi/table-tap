"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import type { SettingsInput } from "@/hooks/useSettings";
import { DEFAULT_TICKET_FONT, isTicketFont } from "@/lib/ticket-font-ids";
import { DEFAULT_TICKET_VAT_RATE, isTicketVatRate, TICKET_VAT_RATES, type TicketVatRate } from "@/lib/ticket-vat";

interface TicketVatCardProps {
  rate: number | undefined;
  /** The saved ticket font, so the sample looks like the owner's own ticket. */
  font: string | undefined;
  saving: boolean;
  save: (input: Partial<SettingsInput>) => Promise<boolean>;
}

/**
 * The IVA line under the ticket's total (owner's decision, 2026-11-12): 16 %,
 * the border region's 8 %, or no line. Owner-only, beside the fiscal data and
 * the ticket's font; the sample ticket shows the saved choice.
 */
export default function TicketVatCard({ rate, font, saving, save }: TicketVatCardProps) {
  const t = useT();
  const toast = useToast();
  const [chosen, setChosen] = useState<TicketVatRate>(isTicketVatRate(rate) ? rate : DEFAULT_TICKET_VAT_RATE);
  const sampleFont = isTicketFont(font) ? font : DEFAULT_TICKET_FONT;

  async function choose(next: TicketVatRate): Promise<void> {
    const before = chosen;
    setChosen(next);
    if (await save({ ticket_vat_rate: next })) toast(t("ticketVat.saved"));
    else setChosen(before);
  }

  return (
    <div className="tt-section" id="iva-ticket">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>{t("ticketVat.title")}</h3>
      </div>
      <p className="tt-muted" style={{ fontSize: 12, margin: "0 0 12px" }}>{t("ticketVat.hint")}</p>
      <div role="radiogroup" aria-label={t("ticketVat.title")} style={{ display: "grid", gap: 10 }}>
        {TICKET_VAT_RATES.map(id => (
          <div key={id} className="tt-ticket-font">
            <label className="tt-ticket-font-pick">
              <input
                type="radio"
                name="ticket-vat"
                value={id}
                checked={chosen === id}
                disabled={saving}
                onChange={() => void choose(id)}
              />
              <span>
                <strong>{t(`ticketVat.rate${id}`)}</strong>
                <span className="tt-muted" style={{ display: "block", fontSize: 12 }}>{t(`ticketVat.rate${id}Hint`)}</span>
              </span>
            </label>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <a
          className="tt-btn tt-btn-ghost tt-btn-sm"
          href={`/api/settings/ticket-preview?font=${sampleFont}`}
          target="_blank"
          rel="noopener"
        >
          {t("ticketVat.preview")}
        </a>
      </div>
    </div>
  );
}
