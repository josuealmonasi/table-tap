"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { formatCode } from "@/lib/accounts";
import type { RemovalResult } from "@/hooks/useStaff";

interface RemovalImpact {
  printer: boolean;
  accountsOpened: number;
  role: string;
}

interface RemoveStaffDialogProps {
  /** The member being removed, or null when closed. */
  member: { id: string; name: string } | null;
  busy: boolean;
  onRemove: (id: string, options: { resetPrinter: boolean; resetAccounts: boolean }) => Promise<RemovalResult | null>;
  onClose: () => void;
}

/**
 * Removing a login does not take back the links its person may have copied:
 * the kitchen printer's link and the customer-account links they opened. The
 * owner chooses here whether to reset them (security sweep 2026-11-24), and
 * gets the new printer link and account codes once, to hand on.
 */
export default function RemoveStaffDialog({ member, busy, onRemove, onClose }: RemoveStaffDialogProps) {
  const t = useT();
  const [impact, setImpact] = useState<RemovalImpact | null>(null);
  const [resetPrinter, setResetPrinter] = useState(false);
  const [resetAccounts, setResetAccounts] = useState(false);
  const [result, setResult] = useState<RemovalResult | null>(null);

  useEffect(() => {
    if (!member) return;
    let live = true;
    setImpact(null);
    setResult(null);
    setResetAccounts(false);
    fetch(`/api/staff?removal=${encodeURIComponent(member.id)}`)
      .then(async r => (r.ok ? ((await r.json()) as RemovalImpact) : { printer: false, accountsOpened: 0, role: "" }))
      .catch(() => ({ printer: false, accountsOpened: 0, role: "" }))
      .then(found => {
        if (!live) return;
        setImpact(found);
        // Managers and owners could open the printer settings: reset by default.
        setResetPrinter(found.printer && (found.role === "manager" || found.role === "owner"));
      });
    return () => {
      live = false;
    };
  }, [member]);

  async function remove(): Promise<void> {
    if (!member) return;
    const done = await onRemove(member.id, {
      resetPrinter: Boolean(impact?.printer && resetPrinter),
      resetAccounts: Boolean(impact?.accountsOpened && resetAccounts),
    });
    if (!done) return;
    if (done.printerReset === undefined && done.accountsReset === undefined) onClose();
    else setResult(done);
  }

  const printerUrl = result?.printerToken && typeof window !== "undefined"
    ? `${window.location.origin}/api/print/cloudprnt/${result.printerToken}` : null;

  return (
    <Modal open={member !== null} onClose={() => { if (!busy) onClose(); }} maxWidth={480}
      title={result ? t("dash.removeDoneTitle") : t("dash.removeConfirm", { name: member?.name ?? "" })}>
      {result ? (
        <>
          {result.printerReset === true && printerUrl && <>
            <p>{t("dash.removeNewPrinterLink")}</p>
            <input className="tt-input" readOnly value={printerUrl} onFocus={e => e.currentTarget.select()} />
          </>}
          {result.printerReset === false && <p className="tt-field-error" role="alert">{t("dash.removePrinterResetFailed")}</p>}
          {result.accountsReset === true && (result.accounts ?? []).length > 0 && <>
            <p>{t("dash.removeNewAccountCodes")}</p>
            <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
              {(result.accounts ?? []).map(a => <li key={a.id}><strong>{a.name}</strong> · {formatCode(a.code)}</li>)}
            </ul>
          </>}
          {result.accountsReset === false && <p className="tt-field-error" role="alert">{t("dash.removeAccountsResetFailed")}</p>}
          <div className="tt-dialog-actions">
            <button type="button" className="tt-btn tt-btn-primary" onClick={onClose}>{t("common.done")}</button>
          </div>
        </>
      ) : (
        <>
          <p className="tt-muted">{t("dash.removeConfirmMsg")}</p>
          {!impact && <p className="tt-muted" role="status">{t("dash.removeChecking")}</p>}
          {impact?.printer && (
            <label className="tt-check" style={{ alignItems: "flex-start", marginTop: 12 }}>
              <input type="checkbox" checked={resetPrinter} onChange={e => setResetPrinter(e.target.checked)} />
              <span>{t("dash.removeResetPrinter")}<br /><small className="tt-muted">{t("dash.removeResetPrinterHelp")}</small></span>
            </label>
          )}
          {impact && impact.accountsOpened > 0 && (
            <label className="tt-check" style={{ alignItems: "flex-start", marginTop: 12 }}>
              <input type="checkbox" checked={resetAccounts} onChange={e => setResetAccounts(e.target.checked)} />
              <span>{t("dash.removeResetAccounts", { n: impact.accountsOpened })}<br /><small className="tt-muted">{t("dash.removeResetAccountsHelp")}</small></span>
            </label>
          )}
          <div className="tt-dialog-actions">
            <button type="button" className="tt-btn tt-btn-ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</button>
            <button type="button" className="tt-btn tt-btn-danger" onClick={() => void remove()} disabled={busy || !impact}>
              {t("common.remove")}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
