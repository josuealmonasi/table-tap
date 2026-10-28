"use client";

import { useTableMembership } from "@/hooks/useTableMembership";
import PendingAttempt from "@/components/ui/PendingAttempt";
import TableJoinNotice from "./table-join-notice";
import { useT } from "@/lib/i18n/context";
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
  const t = useT();
  const membership = useTableMembership(restaurant.id, table?.id ?? null);
  const canOrder = !table || membership.state?.status === "empty" || membership.state?.status === "approved";
  // The visit card at a table: a phone let in carries its sitting's pass; at
  // an empty table the page's own pass, so a party sitting down finds the card
  // before ordering. A phone waiting to be let in, or declined, is not offered it.
  const tableLoyalty = !table || !loyalty ? loyalty
    : membership.state?.status === "approved" ? { ...loyalty, pass: membership.state.pass }
    : membership.state?.status === "empty" && loyalty.pass ? loyalty
    : null;
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

  useEffect(() => { reloadBill(); }, [reloadBill, membership.state?.status, membership.state?.sessionId]);

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
  const { trackIds, sittingSessionId, setSittingSessionId, tracking, setTracking, closeTracker } = orders;
  useEffect(() => {
    // A phone can join without ordering. Keep its sitting when the last part
    // closes membership, or its receipt poll would stop just before the answer.
    if (membership.state?.status === "approved" && membership.state.sessionId) {
      setSittingSessionId(membership.state.sessionId);
    }
  }, [membership.state?.status, membership.state?.sessionId, setSittingSessionId]);

  // Already owing at another table? Ordering here would open a second bill
  // beside one nobody has settled.
  const owingElsewhere = useSitting(restaurant.id, table?.id ?? null);

  // "Want that by email?" — asked once, when the money is settled, whether
  // that happened by card or in cash at the table.
  const receiptSessionId = (membership.state?.status === "approved" ? membership.state.sessionId : null) ?? sittingSessionId;
  const {
    offering,
    paymentId: receiptPaymentId,
    dismiss: dismissReceipt,
    paidNow,
  } = useReceiptOffer(trackOrder?.id ?? null, bill, table && receiptSessionId ? {
    restaurantId: restaurant.id, tableId: table.id, sessionId: receiptSessionId, dividing,
  } : undefined);
  const receiptOpen = Boolean(offering || receiptPaymentId);

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

  const { checkout, loading, frozen, discard } = useCheckout({
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
      setOrderNote("");
      setCoupon(null);
      totals.choosePct(0);
      totals.setTipCustom(null);
      if (sessionId) orders.setSittingSessionId(sessionId);
      orders.track(orderId);
      // Back to the menu, nothing in the way. The bill is a tap away on the
      // receipt button whenever they are ready — pushing it in their face
      // the moment they order interrupts a meal that has not started.
      setScreen("menu");
      reloadBill();
      membership.refresh();
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
          loyalty={tableLoyalty}
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
          notice={<>
            {frozen && <PendingAttempt message={t("pending.order")} />}
            {table && <TableJoinNotice restaurantId={restaurant.id} {...membership} />}
            {tableLoyalty && paidNow && !receiptOpen && !tracking ? <LoyaltyOffer offer={tableLoyalty} /> : null}
          </>}
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
            pendingOrder={frozen}
            onDiscardOrder={discard}
            orderAtRegister={orderAtRegister}
            onEditItem={editLine}
            admissionBlocked={!canOrder}
            admissionNotice={!canOrder && table ? <TableJoinNotice restaurantId={restaurant.id} {...membership} /> : null}
            onCheckout={canOrder || frozen ? checkout : async () => { membership.refresh(); setNotice(t("apiErr.tableJoin")); }}
            onClose={() => setScreen("menu")}
          />
        )}
        {/* One at a time. Paying is answered first — it is what just happened,
          and two dialogs stacked would trap focus against each other and take
          two Escapes to leave. The tracker is underneath it either way. */}
        {tracking && !receiptOpen && (
          <TrackerOverlay
            orderId={tracking}
            initialOrder={trackOrder?.id === tracking ? trackOrder : null}
            onClose={closeTracker}
            loyalty={tableLoyalty}
          />
        )}
        {table && bill && !bill.settled && (
          <BillSheet
            open={billOpen && !receiptOpen}
            onClose={() => setBillOpen(false)}
            bill={bill}
            photoOf={photoOf}
            restaurant={restaurant}
            tableId={table.id}
            tableLabel={table.label}
            sessionId={membership.state?.status === "approved" ? membership.state.sessionId : sittingSessionId}
            staffBill={staffBill}
            party={party}
            dividing={dividing}
          />
        )}
        <OwingElsewhereModal owing={owingElsewhere} currency={restaurant.currency} />
        {receiptOpen && <ReceiptPrompt key={offering?.join(",") ?? receiptPaymentId} orderIds={offering ?? undefined} paymentId={offering ? undefined : receiptPaymentId ?? undefined} email={receipts} open onClose={dismissReceipt} />}
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
