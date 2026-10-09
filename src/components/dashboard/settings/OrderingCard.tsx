"use client";

import { useState } from "react";
import type { Restaurant } from "@/lib/types";
import type { SettingsInput } from "@/hooks/useSettings";
import { BADGES_CHANGED } from "@/hooks/useBadges";
import { useT } from "@/lib/i18n/context";
import { ownerWarningKey } from "@/lib/payment-options";
import SettingsToggle from "./SettingsToggle";
import PlanLock from "@/components/dashboard/plan/PlanLock";

interface OrderingCardProps {
  restaurant: Restaurant;
  isOwner: boolean;
  /** Whether the plan includes paying at the end. False leaves it visible and off. */
  deferredPayAllowed: boolean;
  /** The cheapest plan with pay-later, when this one lacks it. */
  deferredPayUnlocksWith?: string | null;
  /** Whether a Stripe account is connected and charging. Decides what the diner sees. */
  cardsEnabled: boolean;
  saving: boolean;
  save: (input: Partial<SettingsInput>, messageKey?: string) => Promise<boolean>;
}

/**
 * How the place takes orders, each switch saved the moment it is flipped. A
 * failed save puts the switch back, so it never shows a state the restaurant
 * is not in.
 */
export default function OrderingCard({
  restaurant,
  isOwner,
  deferredPayAllowed,
  deferredPayUnlocksWith = null,
  cardsEnabled,
  saving,
  save,
}: OrderingCardProps) {
  const t = useT();
  const [acceptingOrders, setAcceptingOrders] = useState(restaurant.accepting_orders);
  const [payLater, setPayLater] = useState(Boolean(restaurant.allow_pay_later));
  const [splitting, setSplitting] = useState(restaurant.split_enabled !== false);
  const [dealsTab, setDealsTab] = useState(restaurant.deals_tab_enabled !== false);
  const [badges, setBadges] = useState(restaurant.badges_enabled !== false);

  // Recomputed on the fly: if they switch it off with no Stripe, the warning
  // goes from "they cannot pay online" to "nobody can order" right there.
  const paymentWarning = ownerWarningKey({
    cardsEnabled,
    allowDeferred: payLater,
    atTable: true,
    // Pausing orders is a deliberate, temporary act with its own banner; it is
    // not a misconfiguration to warn about here.
    acceptingOrders: true,
  });

  // The kill switch saves immediately — a rushed kitchen shouldn't also have
  // to remember to press "Save".
  async function toggleAcceptingOrders(next: boolean): Promise<void> {
    setAcceptingOrders(next);
    const ok = await save(
      { accepting_orders: next },
      t(next ? "dash.acceptingAgain" : "dash.ordersPaused"),
    );
    if (!ok) setAcceptingOrders(!next); // roll back on failure
  }

  // On by default, and turned off for the whole restaurant rather than per
  // person: a count nobody wants is noise for everybody, and the floor does
  // not get to decide it would rather not be told an approval is waiting.
  async function toggleBadges(next: boolean): Promise<void> {
    setBadges(next);
    if (!(await save({ badges_enabled: next }))) {
      setBadges(!next);
      return;
    }
    window.dispatchEvent(new Event(BADGES_CHANGED));
  }

  async function toggleDealsTab(next: boolean): Promise<void> {
    setDealsTab(next);
    if (!(await save({ deals_tab_enabled: next }))) setDealsTab(!next);
  }

  // Off by default and saved immediately, like the kill switch: turning it on
  // lets food leave the kitchen before it is paid for, so it should be a
  // deliberate act with an obvious result.
  async function togglePayLater(next: boolean): Promise<void> {
    setPayLater(next);
    if (!(await save({ allow_pay_later: next }))) setPayLater(!next);
  }

  // On by default: a table of friends expects to be able to halve a bill. Off
  // is for the places where it gets in the way — a bar on one tab, a set menu,
  // anywhere the floor would rather do the arithmetic itself.
  async function toggleSplitting(next: boolean): Promise<void> {
    setSplitting(next);
    if (!(await save({ split_enabled: next }))) setSplitting(!next);
  }

  const gap = { marginTop: 10 };

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("dash.orderingTitle")}
        </h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>
          {t("dash.orderingHint")}
        </span>
      </div>

      <SettingsToggle
        title={t("dash.acceptingOrders")}
        hint={t("dash.acceptingOrdersHint")}
        stateLabel={t(acceptingOrders ? "dash.accepting" : "dash.paused")}
        checked={acceptingOrders}
        disabled={saving}
        onChange={toggleAcceptingOrders}
      />

      <SettingsToggle
        style={gap}
        title={t("dash.badgesTitle")}
        hint={t("dash.badgesHint")}
        checked={badges}
        disabled={saving}
        onChange={toggleBadges}
      />

      {/* The manager's too: this is how the menu looks, not a decision about
          money or logins. */}
      <SettingsToggle
        style={gap}
        title={t("dash.dealsTabTitle")}
        hint={t("dash.dealsTabHint")}
        checked={dealsTab}
        disabled={saving}
        onChange={toggleDealsTab}
      />

      {/* One question: can the food leave before it is paid for? The answer is
          the same for the whole business; what changes with the QR is who
          holds the order, and that is not the owner's to choose. It was two
          switches and they contradicted each other: with "tables pay at the
          end" on, the general QR still gave the customer no way out of the
          cart. */}
      {isOwner && (
        <SettingsToggle
          style={gap}
          title={t("dash.payLaterTitle")}
          hint={deferredPayAllowed || deferredPayUnlocksWith ? t("dash.payLaterHint") : t("dash.payLaterLocked")}
          checked={payLater}
          disabled={saving || !deferredPayAllowed}
          onChange={togglePayLater}
        />
      )}
      {/* A switch that won't move reads as broken unless it says why and what
          unlocks it — a customer on the free plan reported exactly that. */}
      {isOwner && !deferredPayAllowed && deferredPayUnlocksWith && (
        <PlanLock feature="deferredPayment" unlocksWith={deferredPayUnlocksWith} isOwner compact />
      )}

      {/* Not gated on Stripe, because dividing a bill is not only a way of
          charging one. With no card account the shares are the division the
          table shows the waiter, who collects each of them on the calculator —
          which is most of what a table does with a bill anyway. */}
      <SettingsToggle
        style={gap}
        title={t("dash.splitTitle")}
        hint={t("dash.splitHint")}
        checked={splitting}
        disabled={saving}
        onChange={toggleSplitting}
      />

      {/* What the owner had no way of knowing from here: with no Stripe
          account connected, online payment cannot be painted on any screen,
          so this switch stops being a choice and becomes the only way to
          order. Turning on "pay at the end" and not seeing the card button
          appear had no explanation anywhere.

          Owner only, and not out of discretion: connecting Stripe is theirs —
          the Payments card is not even shown to a manager — so to a manager
          this would be a warning about something they cannot fix. */}
      {isOwner && paymentWarning && (
        <div className="tt-hint tt-hint-row" style={gap}>
          <span>{t(paymentWarning)}</span>
          <a href="#pagos">{t("dash.fixInPayments")}</a>
        </div>
      )}
    </div>
  );
}
