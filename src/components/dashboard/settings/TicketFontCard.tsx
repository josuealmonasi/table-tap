"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import type { SettingsInput } from "@/hooks/useSettings";
import { DEFAULT_TICKET_FONT, isTicketFont, TICKET_FONTS, type TicketFontId } from "@/lib/ticket-font-ids";

interface TicketFontCardProps {
  font: string | undefined;
  saving: boolean;
  save: (input: Partial<SettingsInput>) => Promise<boolean>;
}

/**
 * The ticket's typeface, chosen by looking (owner's request, 2026-11-11):
 * each option opens a sample ticket with the restaurant's own header in a new
 * tab. Owner-only, beside the fiscal data the ticket prints.
 */
export default function TicketFontCard({ font, saving, save }: TicketFontCardProps) {
  const t = useT();
  const toast = useToast();
  const [chosen, setChosen] = useState<TicketFontId>(isTicketFont(font) ? font : DEFAULT_TICKET_FONT);

  async function choose(next: TicketFontId): Promise<void> {
    const before = chosen;
    setChosen(next);
    if (await save({ ticket_font: next })) toast(t("ticketFont.saved"));
    else setChosen(before);
  }

  return (
    <div className="tt-section" id="letra-ticket">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>{t("ticketFont.title")}</h3>
      </div>
      <p className="tt-muted" style={{ fontSize: 12, margin: "0 0 12px" }}>{t("ticketFont.hint")}</p>
      <div role="radiogroup" aria-label={t("ticketFont.title")} style={{ display: "grid", gap: 10 }}>
        {TICKET_FONTS.map(id => (
          <div key={id} className="tt-ticket-font">
            <label className="tt-ticket-font-pick">
              <input
                type="radio"
                name="ticket-font"
                value={id}
                checked={chosen === id}
                disabled={saving}
                onChange={() => void choose(id)}
              />
              <span>
                <strong>{t(`ticketFont.${id}`)}</strong>
                <span className="tt-muted" style={{ display: "block", fontSize: 12 }}>{t(`ticketFont.${id}Hint`)}</span>
              </span>
            </label>
            <a
              className="tt-btn tt-btn-ghost tt-btn-sm"
              href={`/api/settings/ticket-preview?font=${id}`}
              target="_blank"
              rel="noopener"
            >
              {t("ticketFont.preview")}
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
