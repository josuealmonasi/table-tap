"use client";

import { useT } from "@/lib/i18n/context";

import type { Restaurant } from "@/lib/types";
import type { Role } from "@/lib/membership";
import { useSettings } from "@/hooks/useSettings";
import Breadcrumb from "@/components/layout/Breadcrumb";
import PaymentsCard from "./PaymentsCard";
import CoverCard from "./CoverCard";
import InventoryCard from "./InventoryCard";
import TicketTimesCard from "./TicketTimesCard";
import { DEFAULT_TICKET_LATE_MINUTES, DEFAULT_TICKET_WARN_MINUTES } from "@/lib/ticket-wait";
import PrintingCard from "./PrintingCard";
import LogoCard from "./LogoCard";
import RestaurantCard from "./RestaurantCard";
import TaxCard from "./TaxCard";
import OrderingCard from "./OrderingCard";

interface SettingsFormProps {
  restaurant: Restaurant;
  role: Role;
  /** Whether the plan includes paying at the end. False leaves it visible and off. */
  deferredPayAllowed?: boolean;
  /** The cheapest plan with pay-later, when this one lacks it. */
  deferredPayUnlocksWith?: string | null;
  /** Whether the plan includes counting stock. */
  inventoryAllowed?: boolean;
  /** Whether a Stripe account is connected and charging. Decides what the diner sees. */
  cardsEnabled?: boolean;
  /** Whether a printer address has been issued. Never the address itself —
   *  it is a credential, and a page that does not receive it cannot leak it. */
  printerConfigured?: boolean;
}

/** Dashboard Settings: identity + service charge (owner), tax + pausing (owner + manager). */
export default function SettingsForm({
  restaurant,
  role,
  deferredPayAllowed = false,
  deferredPayUnlocksWith = null,
  inventoryAllowed = false,
  cardsEnabled = false,
  printerConfigured = false,
}: SettingsFormProps) {
  const { saving, save } = useSettings();
  const t = useT();
  const isOwner = role === "owner";

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[
              { labelKey: "nav.dashboard", href: "/dashboard" },
              { labelKey: "nav.settings" },
            ]}
          />
        </header>

        {/* What runs the service comes first: pausing orders, kitchen times,
            the printer, stock alerts, tax. A manager opening this mid-shift
            is looking for one of those, not for the logo. The restaurant's
            identity and payment setup follow as their own group. Each group
            is its own column block, so cards never flow across a heading. */}
        <h2 className="tt-serif tt-settings-group">{t("settingsGroups.operation")}</h2>
        <div className="tt-cols">
          <OrderingCard
            restaurant={restaurant}
            isOwner={isOwner}
            deferredPayAllowed={deferredPayAllowed}
            deferredPayUnlocksWith={deferredPayUnlocksWith}
            cardsEnabled={cardsEnabled}
            saving={saving}
            save={save}
          />

          {/* The floor's: how long the kitchen should take before a ticket
              warns, on the board everyone in the kitchen is watching. */}
          <TicketTimesCard
            warn={restaurant.ticket_warn_minutes ?? DEFAULT_TICKET_WARN_MINUTES}
            late={restaurant.ticket_late_minutes ?? DEFAULT_TICKET_LATE_MINUTES}
            save={save}
          />

          {/* The manager's as well: the kitchen printer is floor equipment, and
              whoever is running the shift is who turns it off when it jams. */}
          <PrintingCard
            autoPrint={restaurant.auto_print_kitchen === true}
            hasToken={printerConfigured}
            saving={saving}
            save={save}
          />

          {/* The manager's too. Running out of a dish is the floor's problem
              before it is the owner's, and they are who reorders. */}
          <InventoryCard
            alertsEnabled={restaurant.low_stock_alerts_enabled === true}
            threshold={restaurant.low_stock_threshold ?? 5}
            allowed={inventoryAllowed}
            saving={saving}
            save={save}
          />

          <TaxCard restaurant={restaurant} saving={saving} save={save} />
        </div>

        {isOwner && (
          <>
            <h2 className="tt-serif tt-settings-group">{t("settingsGroups.restaurant")}</h2>
            <div className="tt-cols">
              <RestaurantCard restaurant={restaurant} saving={saving} save={save} />
              <LogoCard restaurant={restaurant} />
              <CoverCard restaurant={restaurant} />
              <PaymentsCard />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
