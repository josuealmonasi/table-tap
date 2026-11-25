"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";

interface Recipient { id: string; email: string; status: "pending" | "confirmed" }

/**
 * Extra recipients of the daily digest: the owner adds up to five outside
 * addresses (an accountant, a partner). Each must confirm from its own inbox
 * before it receives anything, so a typo never sends the day's sales to a
 * stranger. Owner only: the settings page shows this card to the owner.
 */
export default function DigestRecipientsCard() {
  const t = useT();
  const toast = useToast();
  const [recipients, setRecipients] = useState<Recipient[] | null>(null);
  const [max, setMax] = useState(5);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/settings/digest-recipients");
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { recipients: Recipient[]; max: number };
        if (live) { setRecipients(data.recipients); setMax(data.max); }
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => { live = false; };
  }, []);

  async function call(method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/digest-recipients", {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) { toast(typeof data.error === "string" ? data.error : t("apiErr.generic"), "error"); return null; }
      return data;
    } catch {
      toast(t("done.networkError"), "error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function add(): Promise<void> {
    const data = await call("POST", { email: email.trim() });
    if (!data) return;
    setRecipients(data.recipients as Recipient[]);
    setEmail("");
    toast(t(data.sent ? "digestRecipients.confirmSent" : "digestRecipients.confirmNotSent"), data.sent ? undefined : "error");
  }

  async function resend(id: string): Promise<void> {
    const data = await call("PATCH", { id, action: "resend" });
    if (data) toast(t(data.sent ? "digestRecipients.confirmSent" : "digestRecipients.confirmNotSent"), data.sent ? undefined : "error");
  }

  async function remove(id: string): Promise<void> {
    const data = await call("DELETE", { id });
    if (data) setRecipients(data.recipients as Recipient[]);
  }

  const full = (recipients?.length ?? 0) >= max;
  return (
    <div className="tt-section" id="resumen-diario">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>{t("digestRecipients.cardTitle")}</h3>
      </div>
      <p className="tt-muted" style={{ marginTop: 0 }}>{t("digestRecipients.cardHelp", { max: String(max) })}</p>
      {failed && <p className="tt-field-error" role="alert">{t("digestRecipients.loadFailed")}</p>}
      {recipients && recipients.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px", display: "grid", gap: 8 }}>
          {recipients.map(r => (
            <li key={r.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <span style={{ flex: "1 1 180px", minWidth: 0, overflowWrap: "anywhere" }}>{r.email}</span>
              <span className="tt-muted" style={{ fontSize: 13 }}>{t(r.status === "confirmed" ? "digestRecipients.confirmed" : "digestRecipients.pending")}</span>
              {r.status === "pending" && (
                <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" disabled={busy} onClick={() => void resend(r.id)}>{t("digestRecipients.resend")}</button>
              )}
              <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" disabled={busy} onClick={() => void remove(r.id)}>{t("common.remove")}</button>
            </li>
          ))}
        </ul>
      )}
      {recipients && !full && (
        <form className="tt-add-section" onSubmit={e => { e.preventDefault(); void add(); }}>
          <input className="tt-input" type="email" required value={email} placeholder={t("digestRecipients.emailPlaceholder")}
            aria-label={t("digestRecipients.emailPlaceholder")} onChange={e => setEmail(e.target.value)} />
          <button type="submit" className="tt-btn tt-btn-primary tt-btn-sm" disabled={busy || !email.trim()}>{t("digestRecipients.add")}</button>
        </form>
      )}
      {recipients && full && <p className="tt-muted">{t("digestRecipients.fullHint", { max: String(max) })}</p>}
    </div>
  );
}
