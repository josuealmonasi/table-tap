"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { formatCode, normalizeCode } from "@/lib/loyalty/code";
import type { Standing } from "@/lib/loyalty/standing";

interface LookedUp {
  code: string;
  standing: Standing;
  since: string;
  visits: { id: string; day: string; by: string; undoable: boolean }[];
  redeemed: { day: string; reward: string; by: string }[];
}

/**
 * Any of this restaurant's cards, by its code: where it stands, every visit and
 * who stamped it, and the rewards it spent. A manager can take back a visit
 * stamped today — the card scanned twice, the stamp with nothing sold — and
 * nothing older: the record a reward was earned on is not rewritten later.
 */
export default function CardLookup() {
  const t = useT();
  const confirm = useConfirm();
  const toast = useToast();
  const [typed, setTyped] = useState("");
  const [card, setCard] = useState<LookedUp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function undo(visitId: string, code: string): Promise<void> {
    const ok = await confirm({
      title: t("loyaltyAdmin.undoTitle"),
      message: t("loyaltyAdmin.undoBody"),
      confirmLabel: t("loyaltyAdmin.undo"),
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await fetch("/api/loyalty/visit", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: visitId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast(data.error ?? t("apiErr.generic"), "error");
      else toast(t("loyaltyAdmin.undone"));
    } catch {
      toast(t("done.networkError"), "error");
    }
    await look(code);
  }

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
      {error && <p className="tt-field-error" role="alert">{error}</p>}

      {!card && !error && <p className="tt-muted" style={{ fontSize: 13 }}>{t("loyaltyAdmin.lookupHint")}</p>}
      {card && (
        <div className="tt-loyalty-card">
          <p className="tt-rewards-count">
            {formatCode(card.code)} · {t("rewards.visitsOf", { visits: card.standing.visits, goal: card.standing.goal })}
          </p>
          <p className="tt-muted" style={{ fontSize: 12, margin: 0 }}>{t("rewards.memberSince", { date: card.since })}</p>
          <h3 className="tt-loyalty-subhead">{t("loyaltyAdmin.visits")}</h3>
          <ul className="tt-loyalty-list">
            {card.visits.map(v => (
              <li key={v.id}>
                <span>{v.day} · {v.by}</span>
                {v.undoable && (
                  <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => void undo(v.id, card.code)}>
                    {t("loyaltyAdmin.undo")}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {card.redeemed.length > 0 && (
            <>
              <h3 className="tt-loyalty-subhead">{t("rewards.redeemedTitle")}</h3>
              <ul className="tt-loyalty-list">
                {card.redeemed.map((r, i) => (
                  <li key={i}><span>{r.day} · {r.reward} · {r.by}</span></li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
