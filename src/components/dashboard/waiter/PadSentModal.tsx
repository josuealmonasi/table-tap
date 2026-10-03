"use client";

import { useT } from "@/lib/i18n/context";
import { Modal } from "@/components/ui/Modal";

interface PadSentModalProps {
  sent: { code: string; table: string } | null;
  onClose: () => void;
}

/**
 * Sent. The kitchen has it; the table owes for it.
 *
 * A dialog rather than a screen: `.tt-detail-overlay` is a full-bleed sheet
 * below 1025px, which is right for choosing modifiers and wrong for four lines
 * of confirmation — on a phone it read as being taken somewhere, with the pad
 * gone and most of the page empty.
 */
export default function PadSentModal({ sent, onClose }: PadSentModalProps) {
  const t = useT();
  return (
    <Modal
      open={Boolean(sent)}
      onClose={onClose}
      maxWidth={360}
      label={t("waiter.sentTitle")}
    >
      {sent && (
        <div className="tt-pos-ticket-body">
          <p className="tt-pos-ticket-said">{t("waiter.sentTitle")}</p>
          <p className="tt-pos-code">{sent.code}</p>
          <p className="tt-pos-ticket-total">{t("dash.tableN", { label: sent.table })}</p>
          <p className="tt-muted tt-pos-ticket-hint">{t("waiter.sentHint")}</p>
          <button type="button" className="tt-btn tt-btn-primary" onClick={onClose}>
            {t("waiter.next")}
          </button>
        </div>
      )}
    </Modal>
  );
}
