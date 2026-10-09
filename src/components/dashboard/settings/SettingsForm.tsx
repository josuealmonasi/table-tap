"use client";

import type { Restaurant } from "@/lib/types";
import type { Role } from "@/lib/membership";
import { useSettings } from "@/hooks/useSettings";
import Breadcrumb from "@/components/layout/Breadcrumb";
import PaymentsCard from "./PaymentsCard";
import CoverCard from "./CoverCard";
import InventoryCard from "./InventoryCard";
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

        {/* Cards pair up on desktop instead of stacking down one narrow column. */}
        <div className="tt-cols">
          {isOwner && (
            <RestaurantCard restaurant={restaurant} saving={saving} save={save} />
          )}

          {/* Order matters here: the cards flow down one column and into the
              next, so keeping a theme together also decides what shares a
              column. How the place looks comes first — name, logo, cover —
              then how it takes money and runs. */}
          {isOwner && <LogoCard restaurant={restaurant} />}

          {isOwner && <CoverCard restaurant={restaurant} />}

          {isOwner && <PaymentsCard />}

          <TaxCard restaurant={restaurant} saving={saving} save={save} />

          {/* The manager's too. Running out of a dish is the floor's problem
              before it is the owner's, and they are who reorders. */}
          <InventoryCard
            alertsEnabled={restaurant.low_stock_alerts_enabled === true}
            threshold={restaurant.low_stock_threshold ?? 5}
            allowed={inventoryAllowed}
            saving={saving}
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

          <OrderingCard
            restaurant={restaurant}
            isOwner={isOwner}
            deferredPayAllowed={deferredPayAllowed}
            deferredPayUnlocksWith={deferredPayUnlocksWith}
            cardsEnabled={cardsEnabled}
            saving={saving}
            save={save}
          />
        </div>
      </div>
    </div>
  );
}
