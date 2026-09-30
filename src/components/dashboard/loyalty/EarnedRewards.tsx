"use client";

import { useT } from "@/lib/i18n/context";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import CardLookup from "./CardLookup";

/**
 * Rewards a diner already earned, on a tier that no longer has the visit card.
 *
 * The terms promise that a reward already earned is honoured even if the
 * restaurant changes plan. The route to redeem one was never gated on the
 * plan, but on such a tier this page was nothing but a lock and the bills
 * screen hides its stamp button — so no screen could keep the promise. The
 * lookup here redeems and does not stamp, the same as a paused program.
 */
export default function EarnedRewards() {
  const t = useT();
  return (
    <ConfirmProvider>
      <p className="tt-muted" style={{ fontSize: 13 }}>{t("loyaltyAdmin.earnedAfterPlan")}</p>
      <CardLookup active={false} />
    </ConfirmProvider>
  );
}
