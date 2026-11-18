"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";

export type SuspendReason = "non_payment" | "abuse" | "owner_request" | "other";
const REASONS: SuspendReason[] = ["non_payment", "abuse", "owner_request", "other"];

interface AdminSuspendDialogProps {
  name: string;
  /** Already suspended: the dialog lifts it instead. */
  suspended: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: SuspendReason | null) => void;
}

/** Suspend a restaurant with a reason, or lift its suspension. */
export default function AdminSuspendDialog({ name, suspended, busy, onClose, onConfirm }: AdminSuspendDialogProps) {
  const t = useT();
  const [reason, setReason] = useState<SuspendReason>("non_payment");
  const title = suspended ? t("adminSuspend.liftTitle", { name }) : t("adminSuspend.title", { name });

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    onConfirm(suspended ? null : reason);
  }

  return (
    <Modal open onClose={onClose} maxWidth={460} title={title}>
      <form className="tt-prodform" onSubmit={submit}>
        <p className="tt-muted" style={{ margin: 0, fontSize: 13 }}>{suspended ? t("adminSuspend.liftBody") : t("adminSuspend.body")}</p>
        {!suspended && (
          <label className="tt-field">
            <span className="tt-mod-label">{t("adminSuspend.reason")}</span>
            <select className="tt-input" value={reason} onChange={e => setReason(e.target.value as SuspendReason)}>
              {REASONS.map(r => <option key={r} value={r}>{t(`adminSuspend.reason_${r}`)}</option>)}
            </select>
          </label>
        )}
        <div className="tt-prodform-actions">
          <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className={`tt-btn tt-btn-sm ${suspended ? "tt-btn-primary" : "tt-btn-danger"}`} disabled={busy}>
            {busy ? t("common.saving") : suspended ? t("adminSuspend.lift") : t("adminSuspend.confirm")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
