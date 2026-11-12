"use client";

import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { CheckIcon } from "@/components/ui/icons";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { reserveReceiptPopup } from "@/lib/receipt-popup";

export interface PosTicket {
  code: string;
  total: number;
  /** Nothing to make: it went in their hand, not on the pass. */
  handedOver: boolean;
  /** Kept on this device until it can be sent: no connection, or held by the answer. */
  offline?: boolean;
  /** Kept on the device although the server answered: no "no connection". */
  answered?: boolean;
  /** The ticket the till did not print (paperless), for a customer who asks for it. */
  receiptHtml?: string;
}

interface PosTicketModalProps {
  ticket: PosTicket | null;
  currency: string;
  /** The restaurant's name: the printed window's title. */
  title: string;
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
  title,
  onClose,
}: PosTicketModalProps) {
  const t = useT();
  const toast = useToast();
  // Opened inside the click, so the browser lets the window through.
  function printTicket(html: string): void {
    reserveReceiptPopup(reason => {
      toast(t(reason === "blocked" ? "pos.printBlocked" : "pos.printFailed"), "error");
    }).print(html, title);
  }
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
            {ticket.offline ? t(ticket.answered ? "pos.heldAnswered" : "pos.offlineHeld") : ticket.handedOver ? t("pos.handedOver") : t("pos.calledOut")}
          </p>
          {ticket.receiptHtml && (
            <button type="button" className="tt-btn tt-btn-ghost" onClick={() => printTicket(ticket.receiptHtml!)}>
              {t("orders.printReceipt")}
            </button>
          )}
          <button type="button" className="tt-btn tt-btn-primary" onClick={onClose}>
            {t("pos.newSale")}
          </button>
        </div>
      )}
    </Modal>
  );
}
