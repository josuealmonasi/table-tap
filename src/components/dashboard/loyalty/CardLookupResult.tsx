"use client";

import { useT } from "@/lib/i18n/context";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { formatCode } from "@/lib/loyalty/code";
import { useLoyaltyCommand } from "@/hooks/useLoyaltyCommand";
import type { Standing } from "@/lib/loyalty/standing";
import LadderSteps from "@/components/loyalty/LadderSteps";

export interface LookedUp {
  code: string;
  round: number;
  standing: Standing;
  since: string;
  visits: { id: string; day: string; by: string; undoable: boolean }[];
  redeemed: { day: string; reward: string; by: string }[];
}

interface CardLookupResultProps {
  card: LookedUp;
  /** The program is on: the stamp route will take this card. Redeeming a
   *  reward already earned does not depend on it. */
  active: boolean;
  /** Read the card again after anything changed it. */
  onChanged: (code: string) => Promise<void>;
}

/**
 * One card: where it stands, every visit and who stamped it, the rewards it
 * spent, and what can be done to it from here. Stamping and redeeming used to
 * live only behind "Sellar tarjeta" on Cuentas and Caja, so a manager holding
 * a card they had just looked up had to go somewhere else to stamp it.
 */
export default function CardLookupResult({ card, active, onChanged }: CardLookupResultProps) {
  const t = useT();
  const confirm = useConfirm();
  const toast = useToast();
  const { busy, run } = useLoyaltyCommand();

  async function act(path: string, method: "POST" | "DELETE", body: object, done: (data: Record<string, unknown>) => string): Promise<void> {
    // A redemption carries the round and step this card shows (S15).
    const redeem = path === "/api/loyalty/redeem" && card.standing.next
      ? { code: card.code, round: card.round, step: card.standing.next.visits }
      : undefined;
    const answer = await run({ path, method, body, redeem });
    if (answer.status === "busy") return;
    if (answer.status === "done") toast(done(answer.data));
    else toast(answer.error, "error");
    // A redemption that did not land is retried as it is, so the card is not
    // read again under it; anything else may have changed the card.
    if (answer.status === "done" || path !== "/api/loyalty/redeem") await onChanged(card.code);
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
  const reward = s.next?.reward ?? "";
  return (
    <div className="tt-loyalty-card">
      <p className="tt-rewards-count">
        {formatCode(card.code)} · {t("rewards.visitsOf", { visits: s.visits, goal: s.goal })}
      </p>
      <p className="tt-muted" style={{ fontSize: 12, margin: 0 }}>{t("rewards.memberSince", { date: card.since })}</p>
      <LadderSteps standing={s} />
      {s.ready && <p className="tt-rewards-ready">{t("loyalty.ready")}</p>}
      {/* Stamping needs the card switched on. Redeeming does not: a reward a
          diner earned is honoured after a pause — the route says so, and so
          does the diner's own page — so the one screen where a paused card
          can still be found keeps the button that honours it. */}
      {(active || s.ready) && (
        <div className="tt-loyalty-actions">
          {active && (
            <button
              type="button"
              className="tt-btn tt-btn-primary tt-btn-sm"
              disabled={busy}
              onClick={() => void act("/api/loyalty/stamp", "POST", { code: card.code }, d =>
                t(d.stamped ? "loyalty.stamped" : "loyalty.already"))}
            >
              {t("loyaltyAdmin.stampHere")}
            </button>
          )}
          {s.ready && (
            <button
              type="button"
              // The secondary action beside a stamp; the only one when paused.
              className={`tt-btn ${active ? "tt-btn-ghost" : "tt-btn-primary"} tt-btn-sm`}
              disabled={busy}
              onClick={() => void act("/api/loyalty/redeem", "POST", { code: card.code, step: s.next?.visits }, d =>
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
