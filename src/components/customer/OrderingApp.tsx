"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  type Category,
  type MenuItem,
  type OrderLineItem,
  type Restaurant,
  type RestaurantTable,
} from "@/lib/types";
import { priceCart, type AppliedCoupon, type CartPromo } from "@/lib/pricing";
import type { Combo } from "@/lib/promotions";
import { useCart, type CartItem } from "@/hooks/useCart";
import { useT } from "@/lib/i18n/context";
import { readMenuParams, syncMenuUrl } from "@/lib/menu-params";
import { Modal } from "@/components/ui/Modal";
import MenuScreen from "./MenuScreen";
import ItemDetailScreen from "./ItemDetailScreen";
import CartScreen from "./CartScreen";
import ComboDetailScreen from "./ComboDetailScreen";

type Screen = "menu" | "item" | "combo" | "edit" | "cart";

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
}) {
  const [screen, setScreen] = useState<Screen>("menu");
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [selectedCombo, setSelectedCombo] = useState<Combo | null>(null);
  const [editingLine, setEditingLine] = useState<CartItem | null>(null);
  const [orderNote, setOrderNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Product ids that sold out at checkout — kept in the cart but greyed out
  // and excluded from the total and the next payment attempt.
  const [soldOut, setSoldOut] = useState<Set<string>>(new Set());
  const [tipPct, setTipPct] = useState(0);
  const [tipCustom, setTipCustom] = useState<number | null>(null);
  const [coupon, setCoupon] = useState<AppliedCoupon | null>(null);
  const cart = useCart(restaurant.id);
  const t = useT();
  const sharedItemId = readMenuParams(
    new URLSearchParams(useSearchParams().toString()),
  ).item;

  // ?item=<id> opens that dish on load — the "look at this one" link. Runs once:
  // it seeds the screen from the URL and then leaves it alone, so closing the
  // detail doesn't immediately get reopened by the param that put it there.
  useEffect(() => {
    if (!sharedItemId) return;
    const shared = items.find(i => i.id === sharedItemId);
    // A link to a dish that's since been removed or sold out just shows the
    // menu, which is a better landing than an error for something the sender
    // couldn't have known about.
    if (!shared) {
      syncMenuUrl({ item: null });
      return;
    }
    setSelected(shared);
    setScreen("item");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Totals count only the still-orderable lines (sold-out ones are excluded).
  const orderableItems = useMemo(
    () => cart.items.filter(i => !soldOut.has(i.itemId)),
    [cart.items, soldOut],
  );

  // One pricing pass for the whole screen. /api/checkout runs this same
  // function against DB prices, so what's shown here is what gets charged.
  const pricing = useMemo(
    () =>
      priceCart({
        items: orderableItems,
        servicePct: restaurant.service_pct,
        serviceEnabled: restaurant.service_enabled,
        tipPct,
        tipAmount: tipCustom,
        coupon,
        promos,
      }),
    [
      orderableItems,
      restaurant.service_pct,
      restaurant.service_enabled,
      tipPct,
      tipCustom,
      coupon,
      promos,
    ],
  );

  const extrasById = useMemo(() => new Map(extras.map(e => [e.id, e])), [extras]);
  const itemsById = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);

  // The available extra items offered by the currently selected product.
  const selectedExtras = useMemo(() => {
    if (!selected) return [];
    return (extrasByProduct[selected.id] ?? [])
      .map(id => extrasById.get(id))
      .filter((e): e is MenuItem => Boolean(e));
  }, [selected, extrasByProduct, extrasById]);

  // Escape closes the dish detail. It reads as a dialog on desktop, and a
  // dialog that only closes via its own back arrow is a dead end for anyone
  // on a keyboard.
  useEffect(() => {
    if (screen !== "item" && screen !== "edit" && screen !== "combo") return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (screen === "combo") closeCombo();
      else closeDetail(screen === "edit" ? "cart" : "menu");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen]);

  function openItem(item: MenuItem) {
    setSelected(item);
    setScreen("item");
    syncMenuUrl({ item: item.id });
  }

  /** Leaves the dish detail, and takes it out of the shareable URL. */
  function closeDetail(to: Screen) {
    syncMenuUrl({ item: null });
    setScreen(to);
  }

  function addToCart(line: OrderLineItem) {
    cart.addItem(line);
    syncMenuUrl({ item: null });
    setScreen("menu");
  }

  /**
   * Opens the bundle for configuration rather than adding it.
   *
   * It used to drop straight into the cart on the assumption a combo has
   * nothing to customise — but its components are ordinary dishes, with their
   * own options and paid extras, and a deal containing a coffee had no way to
   * ask for oat milk. Two bundles configured differently are also genuinely
   * different lines now, so tapping twice no longer merges them.
   */
  function openCombo(combo: Combo) {
    setSelectedCombo(combo);
    setScreen("combo");
  }

  function closeCombo() {
    setSelectedCombo(null);
    setScreen("menu");
  }

  function addConfiguredCombo(line: OrderLineItem) {
    cart.addItem(line);
    setSelectedCombo(null);
    setScreen("menu");
  }

  /** Re-opens the item screen prefilled with a cart line's choices. */
  function editLine(item: CartItem) {
    const product = items.find(i => i.id === item.itemId);
    if (!product) return; // product left the menu — the line can only be removed
    setSelected(product);
    setEditingLine(item);
    setScreen("edit");
  }

  async function checkout() {
    // Only pay for the still-orderable lines (any already-sold-out ones stay
    // greyed in the cart for the customer to see).
    if (orderableItems.length === 0) {
      setNotice(t("notice.allSoldOut"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantId: restaurant.id,
          tableId: table?.id ?? null,
          tableLabel: table?.label ?? null,
          items: orderableItems.map(c => ({
            itemId: c.itemId,
            name: c.name,
            emoji: c.emoji,
            price: c.price,
            qty: c.qty,
            mods: c.mods,
            extras: c.extras,
            notes: c.notes,
          })),
          note: orderNote || undefined,
          tipPct,
          tipAmount: tipCustom ?? undefined,
          couponCode: coupon?.code,
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url; // Stripe Checkout
        return;
      }
      // The coupon stopped being usable between applying it and paying (most
      // likely someone else took the last use). Drop it and let them retry.
      if (data.couponReason) {
        setCoupon(null);
        setNotice(t(`coupon.${data.couponReason}`));
        setLoading(false);
        return;
      }
      // One or more extras sold out: drop them from the cart, tell the customer,
      // and let them pay again for the adjusted order.
      if (data.removedExtraIds) {
        cart.removeExtras(data.removedExtraIds);
        const names: string[] = data.removedExtraNames ?? [];
        const many = names.length > 1;
        setNotice(
          `${names.join(", ")} ${many ? "are" : "is"} no longer available, so we removed ` +
            `${many ? "them" : "it"} from your order. Review and pay again.`,
        );
        setLoading(false);
        return;
      }
      // An item sold out between loading the menu and checking out: mark it
      // sold out (it greys out and drops from the total) so the rest can pay.
      if (data.unavailableItemId) {
        setSoldOut(prev => new Set(prev).add(data.unavailableItemId));
        setNotice(
          `${data.error} We've marked it sold out — remove it or pay for the rest of your order.`,
        );
      } else {
        setNotice(data.error ?? t("notice.generic"));
      }
      setLoading(false);
    } catch {
      setNotice(t("notice.network"));
      setLoading(false);
    }
  }

  /**
   * The dish detail, layered over whatever screen opened it — the menu when
   * adding, the cart when editing a line.
   *
   * It used to replace that screen outright. On a phone that's right and looks
   * identical to before, but on a wide screen it meant a full-page takeover
   * for one dish: the customer lost their place in the list and read a short
   * form stretched across an otherwise empty page. Keeping the list mounted
   * behind a dialog is both less jarring and a shorter trip back.
   */
  const detail =
    (screen === "item" || screen === "edit") && selected ? (
      <div
        className="tt-detail-overlay"
        onClick={() => closeDetail(screen === "edit" ? "cart" : "menu")}
      >
        <div className="tt-detail-panel" onClick={e => e.stopPropagation()}>
          <ItemDetailScreen
            item={selected}
            extras={selectedExtras}
            currency={restaurant.currency}
            initialLine={screen === "edit" && editingLine ? editingLine : undefined}
            promo={promos.find(p => p.itemIds.includes(selected.id))}
            inCartQty={cart.items
              .filter(i => i.itemId === selected.id && !i.comboId)
              .reduce((n, i) => n + i.qty, 0)}
            onBack={() => closeDetail(screen === "edit" ? "cart" : "menu")}
            onAdd={line => {
              if (screen === "edit" && editingLine) {
                cart.updateItem(editingLine.cartId, line);
                setEditingLine(null);
                closeDetail("cart");
                return;
              }
              addToCart(line);
            }}
          />
        </div>
      </div>
    ) : null;

  const comboDetail =
    screen === "combo" && selectedCombo ? (
      <div className="tt-detail-overlay" onClick={closeCombo}>
        <div className="tt-detail-panel" onClick={e => e.stopPropagation()}>
          <ComboDetailScreen
            combo={selectedCombo}
            currency={restaurant.currency}
            itemsById={itemsById}
            extrasById={extrasById}
            extrasByProduct={extrasByProduct}
            onBack={closeCombo}
            onAdd={addConfiguredCombo}
          />
        </div>
      </div>
    ) : null;

  /**
   * The cart, layered over the menu rather than replacing it — the same
   * treatment the dish detail already gets. On a phone the overlay is opaque
   * and full-bleed, so nothing changes; on a wide screen a checkout form
   * stretched across an empty page was both harder to read and a longer trip
   * back to the food.
   */
  const cartScreen =
    screen === "cart" || screen === "edit" ? (
      <div className="tt-detail-overlay" onClick={() => setScreen("menu")}>
        <div
          className="tt-detail-panel tt-detail-panel-wide"
          onClick={e => e.stopPropagation()}
        >
          <CartScreen
            restaurant={restaurant}
            table={table}
            items={cart.items}
            soldOut={soldOut}
            subtotal={pricing.subtotal}
            grossSubtotal={pricing.grossSubtotal}
            discount={pricing.discount}
            serviceFee={pricing.serviceFee}
            tip={pricing.tip}
            tipPct={tipPct}
            tipCustom={tipCustom}
            total={pricing.total}
            coupon={coupon}
            onApplyCoupon={setCoupon}
            onRemoveCoupon={() => setCoupon(null)}
            hints={pricing.hints}
            promoSavings={pricing.promoSavings}
            orderNote={orderNote}
            loading={loading}
            canCheckout={orderableItems.length > 0 && restaurant.accepting_orders}
            onChangeNote={setOrderNote}
            onChangeTip={pct => {
              setTipPct(pct);
              setTipCustom(null); // picking a preset clears the exact amount
            }}
            onCustomTip={setTipCustom}
            onRemoveItem={cart.removeItem}
            onEditItem={editLine}
            onAddMore={() => setScreen("menu")}
            onCheckout={checkout}
          />
        </div>
      </div>
    ) : null;

  return (
    <>
      <MenuScreen
        restaurant={restaurant}
        table={table}
        categories={categories}
        items={items}
        combos={combos}
        promos={promos}
        ratings={ratings}
        cartCount={cart.count}
        cartTotal={pricing.total}
        onSelectItem={openItem}
        onAddCombo={openCombo}
        onOpenCart={() => setScreen("cart")}
      />
      {cartScreen}
      {detail}
      {comboDetail}
      <Modal
        open={!!notice}
        onClose={() => setNotice(null)}
        maxWidth={400}
        label={t("notice.heads")}
      >
        <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 8 }}>
          {t("notice.heads")}
        </h3>
        <p className="tt-muted" style={{ marginTop: 0 }}>
          {notice}
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button
            className="tt-btn tt-btn-primary tt-btn-sm"
            onClick={() => setNotice(null)}
          >
            {t("notice.ok")}
          </button>
        </div>
      </Modal>
    </>
  );
}
