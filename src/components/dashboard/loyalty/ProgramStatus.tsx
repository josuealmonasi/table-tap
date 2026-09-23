"use client";

import { useT } from "@/lib/i18n/context";

interface ProgramStatusProps {
  active: boolean;
}

/**
 * Whether the visit card is running, and what that means for the restaurant.
 *
 * Off is the state every restaurant starts in, and it looked broken: no offer
 * for a diner, no "Sellar tarjeta" for a waiter, and nothing on this page that
 * said why. On says where a diner gets the card and where the team stamps it,
 * because neither is on this page for them.
 */
export default function ProgramStatus({ active }: ProgramStatusProps) {
  const t = useT();
  return (
    <div className={`tt-loyalty-status ${active ? "tt-loyalty-status-on" : "tt-loyalty-status-off"}`} role="status">
      <strong>{t(active ? "loyaltyAdmin.onTitle" : "loyaltyAdmin.offTitle")}</strong>
      <span>{t(active ? "loyaltyAdmin.onBody" : "loyaltyAdmin.offBody")}</span>
    </div>
  );
}
