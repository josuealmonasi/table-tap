"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { formatCode } from "@/lib/loyalty/code";
import type { Standing } from "@/lib/loyalty/standing";

export interface LookedUp {
  code: string;
  standing: Standing;
  since: string;
  visits: { id: string; day: string; by: string; undoable: boolean }[];
  redeemed: { day: string; reward: string; by: string }[];
}

interface CardLookupResultProps {
  card: LookedUp;
  /** The program is on: the stamp and redeem routes will take this card. */
  active: boolean;
  reward: string;
  /** Read the card again after anything changed it. */
  onChanged: (code: string) => Promise<void>;
}

/**
 * One card: where it stands, every visit and who stamped it, the rewards it
 * spent, and what can be done to it from here. Stamping and redeeming used to
 * live only behind "Sellar tarjeta" on Cuentas and Caja, so a manager holding
 * a card they had just looked up had to go somewhere else to stamp it.
 */
export default function CardLookupResult({ card, active, reward, onChanged }: CardLookupResultProps) {
  const t = useT();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function act(path: string, method: string, body: object, done: (data: Record<string, unknown>) => string): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) toast((data.error as string | undefined) ?? t("apiErr.generic"), "error");
      else toast(done(data));
    } catch {
      // Never queued: a stamp replayed on reconnect is a second visit.
      toast(t("done.networkError"), "error");
    } finally {
      setBusy(false);
    }
    await onChanged(card.code);
  }

  async function undo(visitId: string): Promise<void> {
    const ok = await confirm({
      title: t("loyaltyAdmin.undoTitle"),
      message: t("loyaltyAdmin.undoBody"),
      confirmLabel: t("loyaltyAdmin.undo"),
      danger: true,
    });
    if (ok) await act("/api/loyalty/visit", "DELETE", { id: visitId }, () => t("loyaltyAdmin.undone"));
  }

  const s = card.standing;
  return (
    <div className="tt-loyalty-card">
      <p className="tt-rewards-count">
        {formatCode(card.code)} · {t("rewards.visitsOf", { visits: s.visits, goal: s.goal })}
      </p>
      <p className="tt-muted" style={{ fontSize: 12, margin: 0 }}>{t("rewards.memberSince", { date: card.since })}</p>
      {s.ready && <p className="tt-rewards-ready">{t("loyalty.ready")}</p>}
      {active && (
        <div className="tt-loyalty-actions">
          <button
            type="button"
            className="tt-btn tt-btn-primary tt-btn-sm"
            disabled={busy}
            onClick={() => void act("/api/loyalty/stamp", "POST", { code: card.code }, d =>
              t(d.stamped ? "loyalty.stamped" : "loyalty.already"))}
          >
            {t("loyaltyAdmin.stampHere")}
          </button>
          {s.ready && (
            <button
              type="button"
              className="tt-btn tt-btn-ghost tt-btn-sm"
              disabled={busy}
              onClick={() => void act("/api/loyalty/redeem", "POST", { code: card.code }, d =>
                d.spent ? t("loyalty.redeemed", { reward: d.spent as string }) : t("loyalty.redeemedNoReward"))}
            >
              {reward ? t("loyalty.redeem", { reward }) : t("loyalty.redeemNoReward")}
            </button>
          )}
        </div>
      )}
      <h3 className="tt-loyalty-subhead">{t("loyaltyAdmin.visits")}</h3>
      <ul className="tt-loyalty-list">
        {card.visits.map(v => (
          <li key={v.id}>
            <span>{v.day} · {v.by}</span>
            {v.undoable && (
              <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" disabled={busy} onClick={() => void undo(v.id)}>
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
  );
}
