"use client";

import { useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { useQrCamera } from "@/hooks/useQrCamera";
import { codeFromScan, normalizeCode } from "@/lib/loyalty/code";
import { redeemRequest, forgetRedeemRequest } from "@/lib/loyalty/redeem-request";
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
  const sending = useRef(false);
  const found = useRef<string | null>(null);

  async function send(path: string, code: string, kind: Outcome["kind"], step?: number, round?: number | null): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    let request: ReturnType<typeof redeemRequest> | undefined;
    try {
      if (kind === "redeem") {
        if (typeof round !== "number" || step === undefined) {
          setError(t("apiErr.loyaltyRoundChanged"));
          return;
        }
        try {
          request = redeemRequest(code, round, step);
        } catch {
          setError(t("loyalty.saveRetry"));
          return;
        }
      }
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request ?? { code }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? t("apiErr.generic"));
      else {
        setOutcome({ kind, code, ...data });
        // The answer is already on screen. A cleanup failure must not turn a
        // successful handover into an error inviting another try.
        if (request) { try { forgetRedeemRequest(request); } catch {} }
      }
    } catch {
      // Stamps are never queued: replay on reconnect is a second visit.
      // A redemption keeps its saved key until the same handover is answered.
      setError(t("done.networkError"));
    } finally {
      sending.current = false;
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
            onRedeem={() => void send("/api/loyalty/redeem", outcome.code, "redeem", outcome.standing.next?.visits, outcome.round)}
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
