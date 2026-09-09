"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import type { SettingsInput } from "@/hooks/useSettings";

/**
 * Printing tickets in the kitchen.
 *
 * The counter needs nothing here — the receipt prints from the browser through
 * whatever printer the machine already has. The kitchen is different: nobody
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
  hasToken,
  saving,
  save,
}: {
  autoPrint: boolean;
  /** Whether a URL has ever been issued. The value itself is never sent to the
   *  page on load: it arrives only when somebody asks to see it. */
  hasToken: boolean;
  saving: boolean;
  save: (input: Partial<SettingsInput>) => Promise<boolean>;
}) {
  const t = useT();
  const toast = useToast();
  const [enabled, setEnabled] = useState(autoPrint);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function toggle(next: boolean): Promise<void> {
    setEnabled(next);
    // Put the switch back rather than leave it showing a setting the
    // restaurant does not actually have.
    if (!(await save({ auto_print_kitchen: next }))) setEnabled(!next);
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
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("dash.printingTitle")}
        </h3>
      </div>

      <label className="tt-settings-toggle">
        <span className="tt-muted" style={{ fontSize: 12 }}>
          {t("dash.autoPrintHint")}
        </span>
        <span className="tt-switch">
          <input
            type="checkbox"
            aria-label={t("dash.autoPrintLabel")}
            checked={enabled}
            disabled={saving || busy}
            onChange={e => toggle(e.target.checked)}
          />
          <span className="tt-switch-track" />
        </span>
      </label>

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
