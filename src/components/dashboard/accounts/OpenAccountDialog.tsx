"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";

interface OpenAccountDialogProps {
  open: boolean;
  onClose: () => void;
  onOpened: (id: string) => void;
}

/**
 * Opening an account for a customer the restaurant trusts: their name, the
 * most it may owe (the restaurant's risk, set by whoever opens it), and — only
 * if they want the statement by mail — an email.
 */
export default function OpenAccountDialog({ open, onClose, onOpened }: OpenAccountDialogProps) {
  const t = useT();
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email: email.trim() || undefined, limit: Number(limit) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? t("apiErr.generic"));
        return;
      }
      toast(t("accounts.opened", { name: name.trim() }));
      setName("");
      setEmail("");
      setLimit("");
      onOpened(data.id);
      onClose();
    } catch {
      setError(t("done.networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} maxWidth={460} title={t("accounts.openTitle")}>
      <form className="tt-prodform" onSubmit={e => void submit(e)}>
        <p className="tt-muted" style={{ marginTop: 0, fontSize: 13 }}>{t("accounts.openHint")}</p>
        <label className="tt-field">
          <span className="tt-mod-label">{t("accounts.name")}</span>
          <input className="tt-input" value={name} onChange={e => setName(e.target.value)} maxLength={80} autoFocus required />
        </label>
        <label className="tt-field">
          <span className="tt-mod-label">{t("accounts.limit")}</span>
          <input className="tt-input" inputMode="decimal" value={limit} onChange={e => setLimit(e.target.value)} required />
          <span className="tt-muted" style={{ fontSize: 12 }}>{t("accounts.limitHint")}</span>
        </label>
        <label className="tt-field">
          <span className="tt-mod-label">{t("accounts.email")}</span>
          <input className="tt-input" type="email" value={email} onChange={e => setEmail(e.target.value)} />
          <span className="tt-muted" style={{ fontSize: 12 }}>{t("accounts.emailHint")}</span>
        </label>
        {error && <p className="tt-field-error" role="alert">{error}</p>}
        <div className="tt-prodform-actions">
          <button type="submit" className="tt-btn tt-btn-primary" disabled={busy || !name.trim() || !limit}>
            {busy ? t("common.saving") : t("accounts.openAction")}
          </button>
          <button type="button" className="tt-btn tt-btn-ghost" onClick={onClose}>{t("menu.cancel")}</button>
        </div>
      </form>
    </Modal>
  );
}
