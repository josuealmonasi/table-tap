"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import type { SettingsInput } from "@/hooks/useSettings";
import SettingsToggle from "./SettingsToggle";

/**
 * Printing: the customer's ticket at the till, and tickets in the kitchen.
 *
 * The counter needs no setup — the receipt prints from the browser through
 * whatever printer the machine already has — only the choice of printing at
 * all, which starts off (paperless, the owner's decision of 2026-11-11). The kitchen is different: nobody
 * stands at that printer to press print, so the printer asks us instead. It
 * polls the URL below every few seconds over ordinary outbound HTTPS, which is
 * what lets this work with no software installed at the restaurant and nothing
 * reaching into their network.
 *
 * That URL is the printer's only credential — it cannot log in — so the screen
 * treats it like one: hidden until asked for, and replaceable in one press.
 */
export default function PrintingCard({
  autoPrint,
  tillPrint,
  hasToken,
  saving,
  save,
}: {
  autoPrint: boolean;
  /** The till prints the customer's ticket on every charge (off by default: paperless). */
  tillPrint: boolean;
  /** Whether a URL has ever been issued. The value itself is never sent to the
   *  page on load: it arrives only when somebody asks to see it. */
  hasToken: boolean;
  saving: boolean;
  save: (input: Partial<SettingsInput>) => Promise<boolean>;
}) {
  const t = useT();
  const toast = useToast();
  const [enabled, setEnabled] = useState(autoPrint);
  const [till, setTill] = useState(tillPrint);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean): Promise<void> {
    setEnabled(next);
    // Put the switch back rather than leave it showing a setting the
    // restaurant does not actually have.
    if (!(await save({ auto_print_kitchen: next }))) setEnabled(!next);
  }

  async function toggleTill(next: boolean): Promise<void> {
    setTill(next);
    if (!(await save({ print_ticket_at_till: next }))) setTill(!next);
  }

  async function issue(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch("/api/print/token", { method: "POST" });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        toast(data.error ?? t("done.networkError"), "error");
        return;
      }
      setUrl(`${window.location.origin}/api/print/cloudprnt/${data.token}`);
      toast(t("dash.printerUrlIssued"));
    } catch {
      toast(t("done.networkError"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tt-section" id="impresion">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("dash.printingTitle")}
        </h3>
      </div>

      <SettingsToggle
        title={t("dash.tillPrintLabel")}
        hint={t("dash.tillPrintHint")}
        checked={till}
        disabled={saving || busy}
        onChange={next => void toggleTill(next)}
      />

      <SettingsToggle
        title={t("dash.autoPrintLabel")}
        hint={t("dash.autoPrintHint")}
        checked={enabled}
        disabled={saving || busy}
        onChange={next => void toggle(next)}
        style={{ marginTop: 12 }}
      />

      {/* Only once printing is on: a printer URL for a restaurant that is not
          printing is a secret with nothing to protect and nothing to do. */}
      {enabled && (
        <div style={{ marginTop: 14 }}>
          <p className="tt-mod-label">{t("dash.printerUrlLabel")}</p>
          {url ? (
            <>
              <input className="tt-input" readOnly value={url} onFocus={e => e.target.select()} />
              <p className="tt-muted" style={{ fontSize: 12, marginTop: 6 }}>
                {t("dash.printerUrlCopyHint")}
              </p>
            </>
          ) : (
            <p className="tt-muted" style={{ fontSize: 13, margin: "0 0 10px" }}>
              {hasToken ? t("dash.printerUrlHidden") : t("dash.printerUrlNone")}
            </p>
          )}
          <button
            type="button"
            className="tt-btn"
            style={{ marginTop: 10 }}
            disabled={busy || saving}
            onClick={() => void issue()}
          >
            {hasToken ? t("dash.printerUrlRotate") : t("dash.printerUrlCreate")}
          </button>
          {hasToken && (
            <p className="tt-muted" style={{ fontSize: 12, marginTop: 8 }}>
              {t("dash.printerUrlRotateHint")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
