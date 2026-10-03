"use client";

import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { CheckIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/Modal";

export interface PosTicket {
  code: string;
  total: number;
  /** Nothing to make: it went in their hand, not on the pass. */
  handedOver: boolean;
}

interface PosTicketModalProps {
  ticket: PosTicket | null;
  currency: string;
  onClose: () => void;
}

/**
 * Charged. Shown over the till rather than instead of it — the menu is still
 * there, and the next customer is already at the counter.
 *
 * A dialog rather than a screen: `.tt-detail-overlay` is a full-bleed sheet
 * below 1025px, which is right for choosing modifiers and wrong for four lines
 * of confirmation — on a phone it read as being taken somewhere, with the till
 * gone and most of the page empty.
 */
export default function PosTicketModal({
  ticket,
  currency,
  onClose,
}: PosTicketModalProps) {
  const t = useT();
  return (
    <Modal
      open={Boolean(ticket)}
      onClose={onClose}
      maxWidth={360}
      label={t("pos.charged")}
    >
      {ticket && (
        <div className="tt-pos-ticket-body">
          <span className="tt-pos-ticket-mark" aria-hidden="true">
            <CheckIcon size={26} weight="bold" />
          </span>
          <p className="tt-pos-ticket-said">{t("pos.charged")}</p>
          <p className="tt-pos-code">{ticket.code}</p>
          <p className="tt-pos-ticket-total">{formatMoney(ticket.total, currency)}</p>
          {/* Telling a cashier to call somebody who is still standing there
              with their drink in their hand is the screen not knowing what
              just happened. */}
          <p className="tt-muted tt-pos-ticket-hint">
            {ticket.handedOver ? t("pos.handedOver") : t("pos.calledOut")}
          </p>
          <button type="button" className="tt-btn tt-btn-primary" onClick={onClose}>
            {t("pos.newSale")}
          </button>
        </div>
      )}
    </Modal>
  );
}
