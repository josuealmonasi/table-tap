"use client";

import { useState } from "react";
import useSWR from "swr";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateLocale } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";

interface AdminSupportProps {
  id: string;
}

interface Note { id: string; author: string; body: string; created_at: string }

async function readNotes(url: string): Promise<Note[]> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("Could not read notes");
    return ((await res.json()) as { notes: Note[] }).notes;
  } catch {
    throw new Error("Could not read notes");
  }
}

/** Support tools for one restaurant: the team's private notes and the owner's password reset. */
export default function AdminSupport({ id }: AdminSupportProps) {
  const t = useT();
  const { locale } = useLocale();
  const toast = useToast();
  const { data: notes, error, mutate } = useSWR(`/api/admin/restaurants/notes?id=${encodeURIComponent(id)}`, readNotes);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  async function send(path: string, body: unknown, ok: string): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast((data as { error?: string }).error ?? t("apiErr.generic"), "error"); return false; }
      toast(ok);
      return true;
    } catch {
      toast(t("done.networkError"), "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addNote(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!text.trim()) return;
    if (await send("/api/admin/restaurants/notes", { id, body: text }, t("adminSupport.noteSaved"))) {
      setText("");
      void mutate();
    }
  }

  return (
    <section>
      <h3>{t("adminSupport.title")}</h3>
      <div className="tt-prodform-actions" style={{ justifyContent: "flex-start" }}>
        {confirmReset ? (
          <>
            <span className="tt-muted" style={{ fontSize: 13 }}>{t("adminSupport.resetConfirm")}</span>
            <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => setConfirmReset(false)}>{t("common.cancel")}</button>
            <button type="button" className="tt-btn tt-btn-primary tt-btn-sm" disabled={busy}
              onClick={async () => { await send("/api/admin/restaurants/owner-reset", { id }, t("adminSupport.resetSent")); setConfirmReset(false); }}>
              {t("adminSupport.resetSend")}
            </button>
          </>
        ) : (
          <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => setConfirmReset(true)}>{t("adminSupport.reset")}</button>
        )}
      </div>
      <form className="tt-prodform" onSubmit={e => void addNote(e)}>
        <label className="tt-field">
          <span className="tt-mod-label">{t("adminSupport.notes")}</span>
          <textarea className="tt-input" rows={3} maxLength={2000} value={text} placeholder={t("adminSupport.placeholder")} onChange={e => setText(e.target.value)} />
        </label>
        <div className="tt-prodform-actions">
          <button type="submit" className="tt-btn tt-btn-primary tt-btn-sm" disabled={busy || !text.trim()}>{t("adminSupport.add")}</button>
        </div>
      </form>
      {error ? <p className="tt-muted">{t("adminSupport.notesError")}</p>
        : !notes ? <p className="tt-muted">{t("admin.usageLoading")}</p>
          : notes.length === 0 ? <p className="tt-muted">{t("adminSupport.none")}</p>
            : (
              <ul className="tt-admin-notes">
                {notes.map(n => (
                  <li key={n.id}>
                    <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{n.body}</p>
                    <span className="tt-muted" style={{ fontSize: 12 }}>
                      {n.author} · {new Date(n.created_at).toLocaleString(dateLocale(locale), { timeZone: "America/Mexico_City" })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
    </section>
  );
}
