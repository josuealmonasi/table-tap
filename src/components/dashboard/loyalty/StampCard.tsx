"use client";

import { useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { useQrCamera } from "@/hooks/useQrCamera";
import { codeFromScan, normalizeCode } from "@/lib/loyalty/code";
import { useLoyaltyCommand } from "@/hooks/useLoyaltyCommand";
import StampOutcome, { type Outcome } from "./StampOutcome";

interface StampCardProps {
  buttonClass?: string;
  /** The paid sale this stamp stands on: the one this till just charged. */
  saleId?: string | null;
  /** A manager or the owner: may stamp with no sale, recorded as an override. */
  canOverride?: boolean;
  /** The sale stamped a card, so it cannot stamp another. */
  onSaleUsed?: () => void;
}

/**
 * "Sellar tarjeta": the camera, or the code typed off the card, then what the
 * card now says — and, when its reward is ready, the button that spends it.
 *
 * One dialog for all of it, never one opened from another. Shown only where
 * the server has already said this restaurant takes stamps right now, so the
 * button never leads to "the visit card is switched off".
 */
export default function StampCard({
  buttonClass = "tt-btn tt-btn-ghost tt-btn-sm",
  saleId = null,
  canOverride = false,
  onSaleUsed,
}: StampCardProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const found = useRef<string | null>(null);
  const { busy, run } = useLoyaltyCommand();

  async function send(path: string, code: string, kind: Outcome["kind"], step?: number, round?: number | null): Promise<void> {
    setError(null);
    // A visit stands on a sale (review 2026-11-25); without one, only a
    // manager's stamp goes through, and the server records it as such.
    const body = kind === "stamp" && saleId ? { code, saleId } : { code };
    const answer = await run({ path, body, ...(kind === "redeem" && { redeem: { code, round, step } }) });
    if (answer.status === "done") {
      setOutcome({ kind, code, ...answer.data } as Outcome);
      if (kind === "stamp" && saleId && answer.data.stamped) onSaleUsed?.();
    }
    else if (answer.status !== "busy") setError(answer.error);
  }

  // A waiter or a cashier with no sale at hand cannot stamp: the dialog says
  // how a visit is earned instead of opening a camera the server would refuse.
  const mayStamp = Boolean(saleId) || canOverride;
  const scanning = open && mayStamp && !outcome && !busy && !error;
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
        ) : !mayStamp ? (
          <p className="tt-muted" role="status" style={{ fontSize: 14 }}>{t("loyalty.needsSale")}</p>
        ) : (
          <div className="tt-scan-stage">
            <p className="tt-muted" style={{ fontSize: 13 }}>{t(saleId ? "loyalty.saleNote" : "loyalty.overrideNote")}</p>
            {problem ? (
              <p className="tt-muted" style={{ fontSize: 14 }}>{problem}</p>
            ) : (
              <>
                <p className="tt-muted" style={{ fontSize: 13 }}>{t("loyalty.scanHint")}</p>
                {scanning && <video ref={videoRef} className="tt-scan-view" muted playsInline />}
              </>
            )}
            <form
              className="tt-field"
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
              <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={reset}>
                {t("loyalty.retry")}
              </button>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
