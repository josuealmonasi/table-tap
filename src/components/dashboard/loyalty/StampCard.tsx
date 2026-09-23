"use client";

import { useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { useQrCamera } from "@/hooks/useQrCamera";
import { codeFromScan, normalizeCode } from "@/lib/loyalty/code";
import StampOutcome, { type Outcome } from "./StampOutcome";

interface StampCardProps {
  buttonClass?: string;
}

/**
 * "Sellar tarjeta": the camera, or the code typed off the card, then what the
 * card now says — and, when its reward is ready, the button that spends it.
 *
 * One dialog for all of it, never one opened from another. Shown only where
 * the server has already said this restaurant takes stamps right now, so the
 * button never leads to "the visit card is switched off".
 */
export default function StampCard({ buttonClass = "tt-btn tt-btn-ghost tt-btn-sm" }: StampCardProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const found = useRef<string | null>(null);

  async function send(path: string, code: string, kind: Outcome["kind"]): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? t("apiErr.generic"));
      else setOutcome({ kind, code, ...data });
    } catch {
      // Never queued: a stamp replayed on reconnect is a second visit.
      setError(t("offline.blocked"));
    } finally {
      setBusy(false);
    }
  }

  const scanning = open && !outcome && !busy && !error;
  const { videoRef, problem, setProblem } = useQrCamera(
    scanning,
    raw => {
      found.current = codeFromScan(raw);
      return found.current ? "taken" : "keep-looking";
    },
    () => {
      if (found.current) void send("/api/loyalty/stamp", found.current, "stamp");
    },
    t("loyalty.noCamera"),
  );

  function reset(): void {
    setOutcome(null);
    setError(null);
    setProblem(null);
    setTyped("");
  }

  const typedCode = normalizeCode(typed);

  return (
    <>
      <button
        type="button"
        className={buttonClass}
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        {t("loyalty.stampButton")}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} maxWidth={420} title={t("loyalty.title")}>
        {outcome ? (
          <StampOutcome
            outcome={outcome}
            busy={busy}
            error={error}
            onRedeem={() => void send("/api/loyalty/redeem", outcome.code, "redeem")}
            onAnother={reset}
          />
        ) : (
          <>
            {problem ? (
              <p className="tt-muted" style={{ fontSize: 14, marginTop: 0 }}>{problem}</p>
            ) : (
              <>
                <p className="tt-muted" style={{ fontSize: 13, marginTop: 0 }}>{t("loyalty.scanHint")}</p>
                {scanning && <video ref={videoRef} className="tt-scan-view" muted playsInline />}
              </>
            )}
            <form
              className="tt-stamp-type"
              onSubmit={e => {
                e.preventDefault();
                if (typedCode) void send("/api/loyalty/stamp", typedCode, "stamp");
              }}
            >
              <label className="tt-mod-label" htmlFor="stamp-code">{t("loyalty.typeLabel")}</label>
              <div className="tt-stamp-type-row">
                <input
                  id="stamp-code"
                  className="tt-input tt-rewards-code"
                  value={typed}
                  onChange={e => setTyped(e.target.value)}
                  placeholder="K7QM-3XW9-TB4R"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                />
                <button type="submit" className="tt-btn tt-btn-primary" disabled={!typedCode || busy}>
                  {busy ? t("loyalty.working") : t("loyalty.stamp")}
                </button>
              </div>
            </form>
            {error && <p className="tt-field-error" role="alert">{error}</p>}
            {error && (
              <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={reset} style={{ marginTop: 8 }}>
                {t("loyalty.retry")}
              </button>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
