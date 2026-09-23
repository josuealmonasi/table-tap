"use client";

import { useRef, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { useQrCamera } from "@/hooks/useQrCamera";
import { ScanIcon } from "@/components/ui/icons";
import { codeFromScan, formatCode, normalizeCode } from "@/lib/loyalty/code";
import CardLookupResult, { type LookedUp } from "./CardLookupResult";

interface CardLookupProps {
  /** The program is on, so the card can be stamped and redeemed from here. */
  active: boolean;
  reward: string;
}

/**
 * Any of this restaurant's cards, found by its code — typed, or read off the
 * diner's phone with the camera. Typing twelve characters from a screen held
 * out across a counter is the slow way, and it was the only one this page had.
 */
export default function CardLookup({ active, reward }: CardLookupProps) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const [card, setCard] = useState<LookedUp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const found = useRef<string | null>(null);

  async function look(code: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/loyalty/lookup?c=${code}`);
      const data = await res.json();
      if (!res.ok) {
        setCard(null);
        setError(data.error ?? t("apiErr.generic"));
      } else setCard(data as LookedUp);
    } catch {
      setError(t("done.networkError"));
    } finally {
      setBusy(false);
    }
  }

  const { videoRef, problem, setProblem } = useQrCamera(
    scanning,
    raw => {
      found.current = codeFromScan(raw);
      return found.current ? "taken" : "keep-looking";
    },
    () => {
      const code = found.current;
      setScanning(false);
      if (code) {
        setTyped(formatCode(code));
        void look(code);
      }
    },
    t("loyalty.noCamera"),
  );

  const code = normalizeCode(typed);

  return (
    <section className="tt-section">
      <div className="tt-section-head">
        <h2 className="tt-serif" style={{ margin: 0 }}>{t("loyaltyAdmin.lookupTitle")}</h2>
      </div>
      <form
        className="tt-stamp-type-row"
        onSubmit={e => {
          e.preventDefault();
          if (code) void look(code);
        }}
      >
        <input
          className="tt-input tt-rewards-code"
          value={typed}
          onChange={e => setTyped(e.target.value)}
          placeholder="K7QM-3XW9-TB4R"
          aria-label={t("rewards.codeLabel")}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="tt-btn tt-btn-ghost" disabled={!code || busy}>
          {t("loyaltyAdmin.lookup")}
        </button>
      </form>
      <div className="tt-loyalty-actions">
        {/* Outlined, not ghost: on its own a ghost button is loose text, and
            this is the quick way in — the one the page did not have. */}
        <button
          type="button"
          className="tt-btn tt-btn-outline tt-btn-sm"
          onClick={() => {
            setProblem(null);
            setScanning(s => !s);
          }}
        >
          <ScanIcon size={16} weight="bold" />
          {scanning ? t("loyaltyAdmin.closeCamera") : t("loyaltyAdmin.scan")}
        </button>
      </div>
      {scanning && (
        problem
          ? <p className="tt-muted" style={{ fontSize: 13 }}>{problem}</p>
          : (
            <>
              <p className="tt-muted" style={{ fontSize: 13, margin: "8px 0" }}>{t("loyaltyAdmin.scanning")}</p>
              <video ref={videoRef} className="tt-scan-view" muted playsInline />
            </>
          )
      )}
      {error && <p className="tt-field-error" role="alert">{error}</p>}

      {!card && !error && !scanning && <p className="tt-muted" style={{ fontSize: 13 }}>{t("loyaltyAdmin.lookupHint")}</p>}
      {card && <CardLookupResult card={card} active={active} reward={reward} onChanged={look} />}
    </section>
  );
}
