"use client";

import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";

interface NoticeModalProps {
  notice: string | null;
  onClose: () => void;
}

/** "Atención": what checkout had to say — a dish gone, a coupon used up. */
export default function NoticeModal({ notice, onClose }: NoticeModalProps) {
  const t = useT();
  return (
    <Modal open={!!notice} onClose={onClose} maxWidth={400} label={t("notice.heads")}>
      <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 8 }}>
        {t("notice.heads")}
      </h3>
      <p className="tt-muted" style={{ marginTop: 0 }}>
        {notice}
      </p>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <button className="tt-btn tt-btn-primary tt-btn-sm" onClick={onClose}>
          {t("notice.ok")}
        </button>
      </div>
    </Modal>
  );
}
