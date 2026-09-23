"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useT } from "@/lib/i18n/context";
import { formatCode, normalizeCode } from "@/lib/loyalty/code";
import RewardsCard, { type CardStanding } from "./RewardsCard";

interface RewardsLookupProps {
  /** From the card's QR link, so the camera lands straight on the answer. */
  initialCode?: string;
}

/**
 * The /rewards page: a code in, where the card stands out.
 *
 * Nothing is remembered here. The code is the card, and the diner already has
 * it on their phone; keeping it in this browser as well would be one more
 * place it could be read from.
 */
export default function RewardsLookup({ initialCode = "" }: RewardsLookupProps) {
  const t = useT();
  const { locale } = useLocale();
  const [code, setCode] = useState(initialCode ? formatCode(normalizeCode(initialCode) ?? initialCode) : "");
  const [card, setCard] = useState<CardStanding | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const look = useCallback(
    async (typed: string) => {
      const normal = normalizeCode(typed);
      if (!normal) {
        setError(t("rewards.invalid"));
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/rewards?c=${normal}`);
        const data = await res.json();
        if (!res.ok) {
          setCard(null);
          setError(data.error ?? t("apiErr.generic"));
        } else {
          setCard(data as CardStanding);
        }
      } catch {
        setError(t("offline.blocked"));
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  // The QR brought a code: answer at once rather than make them press a button.
  useEffect(() => {
    if (initialCode) void look(initialCode);
  }, [initialCode, look]);

  return (
    <div className="tt-login">
      <div className="container">
        {card ? (
          <div className="tt-login-card">
            <RewardsCard card={card} locale={locale} />
            <button
              type="button"
              className="tt-btn tt-btn-ghost"
              style={{ marginTop: 20, width: "100%" }}
              onClick={() => {
                setCard(null);
                setCode("");
              }}
            >
              {t("rewards.another")}
            </button>
          </div>
        ) : (
          <form
            className="tt-login-card"
            onSubmit={e => {
              e.preventDefault();
              void look(code);
            }}
          >
            <h1 className="tt-serif" style={{ margin: "8px 0 4px" }}>
              {t("rewards.title")}
            </h1>
            <p className="tt-muted" style={{ marginTop: 0 }}>
              {t("rewards.intro")}
            </p>
            <label className="tt-mod-label tt-rewards-label" htmlFor="rewards-code">
              {t("rewards.codeLabel")}
            </label>
            <input
              id="rewards-code"
              className="tt-input tt-rewards-code"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="K7QM-3XW9-TB4R"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              inputMode="text"
            />
            {error && (
              <p className="tt-field-error" role="alert">
                {error}
              </p>
            )}
            <button className="tt-btn tt-btn-primary" type="submit" disabled={busy} style={{ marginTop: 14, width: "100%" }}>
              {busy ? t("rewards.checking") : t("rewards.check")}
            </button>
            <p className="tt-muted" style={{ fontSize: 13, marginTop: 20 }}>
              {t("rewards.noData")}
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
