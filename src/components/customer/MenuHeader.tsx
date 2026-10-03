"use client";

import type { ReactNode } from "react";
import type { Restaurant, RestaurantTable } from "@/lib/types";
import { orderCode } from "@/lib/types";
import { useT } from "@/lib/i18n/context";
import type { LoyaltyOfferInfo } from "@/lib/loyalty/offer";
import type { MenuViewState } from "@/hooks/useMenuView";
import { BillIcon, CloseIcon, SearchIcon, TableIcon } from "@/components/ui/icons";
import RestaurantMark, { hasMark } from "@/components/ui/RestaurantMark";
import CoverBanner from "./CoverBanner";
import LanguageToggle from "./LanguageToggle";
import LoyaltyMenuEntry from "./LoyaltyMenuEntry";
import MenuScanButton from "./MenuScanButton";
import ServiceButtons from "./ServiceButtons";

interface MenuHeaderProps {
  restaurant: Restaurant;
  table: RestaurantTable | null;
  loyalty: LoyaltyOfferInfo | null;
  view: MenuViewState;
  orderAtRegister: boolean;
  billDue: boolean;
  onOpenBill?: () => void;
  trackIds?: string[];
  onTrack?: (orderId: string) => void;
  notice?: ReactNode;
}

/**
 * The top of the menu: the photo, the restaurant, the table, the service
 * buttons and the orders still being made.
 *
 * Photo, floating controls and identity share one box on purpose: it is what
 * the sticky controls are bounded by, so they pin while the photo and the name
 * scroll under them and then hand over to the category bar at the bottom of
 * it, which keeps its own behaviour unchanged.
 */
export default function MenuHeader({
  restaurant,
  table,
  loyalty,
  view,
  orderAtRegister,
  billDue,
  onOpenBill,
  trackIds,
  onTrack,
  notice,
}: MenuHeaderProps) {
  const t = useT();
  const { search, changeSearch, searchOpen, setSearchOpen } = view;
  const showCover = Boolean(restaurant.cover_enabled && restaurant.cover_url);

  // Over the photo when there is one, otherwise beside the search. It is the
  // one control a diner may need before reading anything, so it sits highest.
  const langToggle = <LanguageToggle />;

  return (
    <div className="tt-cover-stack">
      {showCover && (
        <>
          <div className="tt-cover-controls">{langToggle}</div>
          <CoverBanner
            url={restaurant.cover_url}
            enabled={restaurant.cover_enabled}
            name={restaurant.name}
            priority
          />
        </>
      )}
      <div className="tt-menu-header">
        {hasMark(restaurant.logo_url, restaurant.logo) && (
          <div className="tt-brand-logo">
            <RestaurantMark
              logoUrl={restaurant.logo_url}
              emoji={restaurant.logo}
              name={restaurant.name}
            />
          </div>
        )}
        <div className="tt-row tt-brand-row">
          <div className="tt-serif tt-brand-name">{restaurant.name}</div>
          <div className="tt-head-controls">
            {!showCover && langToggle}
            <MenuScanButton />
            {/* The search is a circle on a phone, on the name's line, and a
                field on a wide screen, where the identity line has room to
                keep it open. Both write the same query, so a resize keeps it. */}
            <button
              type="button"
              className="tt-icon-round tt-search-toggle"
              aria-label={t("menu.search")}
              aria-expanded={searchOpen}
              // Closing clears the query. Hiding the input while keeping the term left
              // the menu filtered with nothing on screen to say why — the categories
              // vanish under an active search, so a diner saw two dishes, no search
              // box, and no way back short of reloading.
              onClick={() => {
                if (searchOpen) changeSearch("");
                setSearchOpen(open => !open);
              }}
            >
              {searchOpen ? (
                <CloseIcon size={17} weight="bold" />
              ) : (
                <SearchIcon size={17} weight="bold" />
              )}
            </button>
            <div className="tt-search-field">
              <SearchIcon size={17} weight="bold" />
              <input
                type="search"
                value={search}
                placeholder={t("menu.searchIn", { name: restaurant.name })}
                aria-label={t("menu.searchIn", { name: restaurant.name })}
                onChange={e => changeSearch(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="tt-sage tt-brand-tagline">{restaurant.tagline}</div>
        {(table || loyalty) && (
          <div className="tt-menu-badges">
            {table && (
              <span className="tt-badge tt-badge-onink">
                <TableIcon size={13} weight="bold" />
                {t("menu.table", { label: table.label })}
              </span>
            )}
            {loyalty && <LoyaltyMenuEntry offer={loyalty} />}
          </div>
        )}

        {searchOpen && (
          <input
            className="tt-input tt-customer-search"
            type="search"
            placeholder={t("menu.search")}
            aria-label={t("menu.search")}
            autoFocus
            value={search}
            onChange={e => changeSearch(e.target.value)}
          />
        )}
        {/* Not on Caja: nobody waits tables there, and the bill is paid at the
            register, so both buttons would call for what the plan has not got. */}
        {table && !orderAtRegister && (
          <div className="tt-service-row">
            <ServiceButtons restaurantId={restaurant.id} table={table} />
            {/* One door to the bill, and it says what it does. "Ask for the
                bill" describes asking somebody to bring a piece of paper;
                here the bill is looked at, and both ways of paying it are
                inside. With nothing owed it does not appear: an empty bill
                is not a screen worth opening. */}
            {billDue && onOpenBill && (
              <button type="button" className="tt-service-btn" onClick={onOpenBill}>
                <BillIcon size={16} weight="bold" />
                {t("menu.myBill")}
              </button>
            )}
          </div>
        )}
        {/* One banner per order still in the kitchen. A counter has no table
            to hang a running tab on, so remembering a drink after ordering
            food makes a SECOND order — and both deserve watching. With more
            than one, each says which it is; with one, the plain sentence
            reads better than a code nobody needs yet. */}
        {onTrack &&
          (trackIds ?? []).map(id => (
            <button
              key={id}
              type="button"
              className="tt-track-banner"
              onClick={() => onTrack(id)}
            >
              <BillIcon size={14} weight="bold" />{" "}
              {(trackIds ?? []).length > 1
                ? t("menu.trackThisOrder", { code: orderCode(id) })
                : t("menu.trackOrder")}
            </button>
          ))}
        {orderAtRegister ? (
          <div className="tt-closed-banner" role="status">
            {t("menu.orderAtRegister")}
          </div>
        ) : (
          !restaurant.accepting_orders && (
            <div className="tt-closed-banner" role="status">
              {t("menu.closed")}
            </div>
          )
        )}
        {notice}
      </div>
    </div>
  );
}
