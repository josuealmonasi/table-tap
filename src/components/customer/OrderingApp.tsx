"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type Category,
  type MenuItem,
  type Restaurant,
  type RestaurantTable,
} from "@/lib/types";
import type { CartPromo } from "@/lib/pricing";
import type { Combo } from "@/lib/promotions";
import { useCart } from "@/hooks/useCart";
import { recallDinerName } from "@/lib/diner-name";
import MenuScreen from "./MenuScreen";
import DishOverlays from "./DishOverlays";
import CartOverlay from "./CartOverlay";
import NoticeModal from "./NoticeModal";
import OwingElsewhereModal from "./OwingElsewhereModal";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { DietaryTagsProvider } from "@/components/DietaryTagsContext";
import type { StoredDietaryTag } from "@/lib/dietary";
import { useMenuFreshness } from "@/hooks/useMenuFreshness";
import { useTableBill } from "@/hooks/useTableBill";
import { useReceiptOffer } from "@/hooks/useReceiptOffer";
import { useUsualOrder } from "@/hooks/useUsualOrder";
import { useTrackedOrders } from "@/hooks/useTrackedOrders";
import { useUpsell } from "@/hooks/useUpsell";
import { useCheckout } from "@/hooks/useCheckout";
import { useCartTotals } from "@/hooks/useCartTotals";
import { useOrderingScreens } from "@/hooks/useOrderingScreens";
import LoyaltyOffer from "./LoyaltyOffer";
import type { LoyaltyOfferInfo } from "@/lib/loyalty/offer";
import { useSitting } from "@/hooks/useSitting";
import BillSheet from "./BillSheet";
import ReceiptPrompt from "./ReceiptPrompt";
import TrackerOverlay from "./TrackerOverlay";
import type { TrackedOrder } from "@/lib/order-tracking";

/**
 * The QR-target customer app. Owns which screen is showing and the cart, and
 * delegates rendering to MenuScreen / ItemDetailScreen / CartScreen.
 */
export default function OrderingApp({
  restaurant,
  table,
  categories,
  items,
  extras,
  extrasByProduct,
  combos = [],
  promos = [],
  ratings = {},
  closedNow = false,
  orderAtRegister = false,
  receipts = false,
  loyalty = null,
  trackOrder = null,
  dietaryTags = null,
}: {
  restaurant: Restaurant;
  table: RestaurantTable | null;
  categories: Category[];
  items: MenuItem[];
  extras: MenuItem[];
  extrasByProduct: Record<string, string[]>;
  combos?: Combo[];
  promos?: CartPromo[];
  ratings?: Record<string, { avg: number; count: number }>;
  /** No menu is serving at this hour. */
  closedNow?: boolean;
  /** Caja: the menu is to read, and the order is taken at the register. */
  orderAtRegister?: boolean;
  /** A receipt can be emailed — false when no mail provider is configured. */
  receipts?: boolean;
  /** The visit card, when this restaurant offers one right now. */
  loyalty?: LoyaltyOfferInfo | null;
  /** The restaurant's dietary tags. Without them the built-ins are shown. */
  dietaryTags?: StoredDietaryTag[] | null;
  /**
   * An order to open the tracker on: the landing Stripe returns to, and any
   * shared /order/<id> link. The menu is rendered behind it.
   */
  trackOrder?: TrackedOrder | null;
}) {
  const [orderNote, setOrderNote] = useState("");
  // Only ever filled from the general QR; the cart hides the field at a table.
  // Seeded from what they gave last time, so a second order does not mean
  // typing their name again — and so two orders at one counter are not under
  // two spellings of the same person.
  const [customerName, setCustomerName] = useState("");
  useEffect(() => {
    setCustomerName(prev => prev || recallDinerName(restaurant.id));
  }, [restaurant.id]);
  const [notice, setNotice] = useState<string | null>(null);
  // What the table still owes. Only meaningful at a table: a fast-food QR pays
  // as it orders, so there is never an open bill.
  const [billOpen, setBillOpen] = useState(false);
  const {
    bill,
    reload: reloadBill,
    staffBill,
    party,
    dividing,
  } = useTableBill(restaurant.id, table?.id ?? null, billOpen);

  // Re-asks the server what is being served, so a dish pulled while this page
  // sat open stops being orderable here too.
  useMenuFreshness();
  const cart = useCart(restaurant.id);
  // Which screen is showing — menu, dish, combo, a cart line, the cart.
  const screens = useOrderingScreens(cart, items, combos);
  const { screen, setScreen, openItem, openCombo, editLine } = screens;

  // "Lo de siempre", as today's menu can make it.
  const { usual, forget: forgetUsualOrder } = useUsualOrder(
    restaurant.id,
    items,
    extras,
    extrasByProduct,
  );

  // What the cart comes to, sold-out lines left out.
  const totals = useCartTotals(cart, items, restaurant, promos);
  const { markSoldOut, orderableItems, pricing, tipPct, tipCustom, coupon, setCoupon } = totals;

  // The orders this phone can still watch, its sitting, and the tracker.
  const orders = useTrackedOrders(restaurant.id, table?.id ?? null, trackOrder);
  const { trackIds, sittingSessionId, tracking, setTracking, closeTracker } = orders;

  // Already owing at another table? Ordering here would open a second bill
  // beside one nobody has settled.
  const owingElsewhere = useSitting(restaurant.id, table?.id ?? null);

  // "Want that by email?" — asked once, when the money is settled, whether
  // that happened by card or in cash at the table.
  const {
    offering,
    dismiss: dismissReceipt,
    paidNow,
  } = useReceiptOffer(receipts, trackOrder?.id ?? null, bill);

  // "Anything else?" — asked on the way to ordering, and asked once.
  const offered = useUpsell(screen === "cart", restaurant.id, cart.items, items, ratings);

  function pickSuggestion(item: MenuItem): void {
    // The ordinary dish screen, so options and notes are still asked for —
    // and adding it comes back here, to the order they were in the middle of.
    openItem(item, "cart");
  }

  const photoOf = useMemo(() => {
    const byId = new Map(items.map(i => [i.id, i.image_url]));
    return (itemId: string) => byId.get(itemId) ?? null;
  }, [items]);

  const { checkout, loading } = useCheckout({
    restaurantId: restaurant.id,
    table,
    orderableItems,
    orderNote,
    customerName,
    tipPct,
    tipCustom,
    coupon,
    cart,
    dropCoupon: () => setCoupon(null),
    markSoldOut,
    notify: setNotice,
    onPlaced: (orderId, sessionId) => {
      if (sessionId) orders.setSittingSessionId(sessionId);
      orders.track(orderId);
      // Back to the menu, nothing in the way. The bill is a tap away on the
      // receipt button whenever they are ready — pushing it in their face
      // the moment they order interrupts a meal that has not started.
      setScreen("menu");
      reloadBill();
    },
  });

  return (
    // The cart's remove asks before it deletes, and useConfirm needs its
    // provider above it — the dashboard has one per page, the customer app
    // is a single screen so it wraps the lot.
    <DietaryTagsProvider tags={dietaryTags}>
      <ConfirmProvider>
        <MenuScreen
          restaurant={restaurant}
          table={table}
          loyalty={loyalty}
          trackIds={trackIds}
          categories={categories}
          items={items}
          combos={combos}
          promos={promos}
          ratings={ratings}
          closedNow={closedNow}
          orderAtRegister={orderAtRegister}
          cartCount={cart.count}
          cartTotal={pricing.total}
          onSelectItem={item => openItem(item)}
          onAddCombo={openCombo}
          onOpenCart={() => setScreen("cart")}
          usual={usual}
          onAddUsual={() => {
            for (const line of usual) cart.addItem(line);
            setScreen("cart");
          }}
          onForgetUsual={forgetUsualOrder}
          onTrack={id => setTracking(id ?? trackIds[0] ?? null)}
          billDue={Boolean(table && bill && !bill.settled)}
          // The visit card, offered once the money is settled — after the
          // receipt question, never on top of it, and not behind the tracker,
          // which offers it itself.
          notice={
            loyalty && paidNow && !offering && !tracking ? (
              <LoyaltyOffer offer={loyalty} />
            ) : null
          }
          onOpenBill={() => {
            reloadBill();
            setBillOpen(true);
          }}
        />
        {(screen === "cart" || screen === "edit") && (
          <CartOverlay
            restaurant={restaurant}
            table={table}
            cart={cart}
            totals={totals}
            photoOf={photoOf}
            suggestions={offered}
            onPickSuggestion={pickSuggestion}
            orderNote={orderNote}
            onChangeNote={setOrderNote}
            customerName={customerName}
            onChangeName={setCustomerName}
            loading={loading}
            orderAtRegister={orderAtRegister}
            onEditItem={editLine}
            onCheckout={checkout}
            onClose={() => setScreen("menu")}
          />
        )}
        {/* One at a time. Paying is answered first — it is what just happened,
          and two dialogs stacked would trap focus against each other and take
          two Escapes to leave. The tracker is underneath it either way. */}
        {tracking && !offering && (
          <TrackerOverlay
            orderId={tracking}
            initialOrder={trackOrder?.id === tracking ? trackOrder : null}
            onClose={closeTracker}
            loyalty={loyalty}
          />
        )}
        {table && bill && !bill.settled && (
          <BillSheet
            open={billOpen}
            onClose={() => setBillOpen(false)}
            bill={bill}
            photoOf={photoOf}
            restaurant={restaurant}
            tableId={table.id}
            tableLabel={table.label}
            sessionId={sittingSessionId}
            staffBill={staffBill}
            party={party}
            dividing={dividing}
          />
        )}
        <OwingElsewhereModal owing={owingElsewhere} currency={restaurant.currency} />
        {offering && <ReceiptPrompt orderIds={offering} open onClose={dismissReceipt} />}
        <DishOverlays
          screens={screens}
          currency={restaurant.currency}
          promos={promos}
          cartItems={cart.items}
          items={items}
          extras={extras}
          extrasByProduct={extrasByProduct}
        />
        <NoticeModal notice={notice} onClose={() => setNotice(null)} />
      </ConfirmProvider>
    </DietaryTagsProvider>
  );
}
