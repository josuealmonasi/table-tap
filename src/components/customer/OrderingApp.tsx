"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Modal } from "@/components/ui/Modal";
import MenuScreen from "./MenuScreen";
import ItemDetailScreen from "./ItemDetailScreen";
import CartScreen from "./CartScreen";

type Screen = "menu" | "item" | "edit" | "cart";

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
}: {
  restaurant: Restaurant;
  table: RestaurantTable | null;
  categories: Category[];
  items: MenuItem[];
  extras: MenuItem[];
  extrasByProduct: Record<string, string[]>;
  combos?: Combo[];
  promos?: CartPromo[];
}) {
  const [screen, setScreen] = useState<Screen>("menu");
  const [selected, setSelected] = useState<MenuItem | null>(null);
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
  const cart = useCart();
  const t = useT();

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
    if (screen !== "item" && screen !== "edit") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setScreen(screen === "edit" ? "cart" : "menu");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen]);

  function openItem(item: MenuItem) {
    setSelected(item);
    setScreen("item");
  }

  function addToCart(line: OrderLineItem) {
    cart.addItem(line);
    setScreen("menu");
  }

  /**
   * A combo goes in as a single line priced at the bundle price, carrying its
   * components so the kitchen ticket still lists what to make. Checkout
   * re-reads the bundle price from the DB before charging.
   */
  function addCombo(combo: Combo) {
    // A combo has nothing to customise, so tapping it again means "one more"
    // rather than a second identical line.
    const existing = cart.items.find(i => i.comboId === combo.id);
    if (existing) {
      cart.updateItem(existing.cartId, { ...existing, qty: existing.qty + 1 });
      return;
    }
    cart.addItem({
      itemId: combo.id,
      comboId: combo.id,
      name: combo.name,
      emoji: combo.emoji || "🎁",
      price: combo.price,
      qty: 1,
      mods: {},
      components: combo.components,
    });
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
        onClick={() => setScreen(screen === "edit" ? "cart" : "menu")}
      >
        <div className="tt-detail-panel" onClick={e => e.stopPropagation()}>
          <ItemDetailScreen
            item={selected}
            extras={selectedExtras}
            currency={restaurant.currency}
            initialLine={screen === "edit" && editingLine ? editingLine : undefined}
            onBack={() => setScreen(screen === "edit" ? "cart" : "menu")}
            onAdd={line => {
              if (screen === "edit" && editingLine) {
                cart.updateItem(editingLine.cartId, line);
                setEditingLine(null);
                setScreen("cart");
                return;
              }
              addToCart(line);
            }}
          />
        </div>
      </div>
    ) : null;

  if (screen === "cart" || screen === "edit") {
    return (
      <>
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
        {detail}
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

  return (
    <>
      <MenuScreen
        restaurant={restaurant}
        table={table}
        categories={categories}
        items={items}
        combos={combos}
        promos={promos}
        cartCount={cart.count}
        cartTotal={pricing.total}
        onSelectItem={openItem}
        onAddCombo={addCombo}
        onOpenCart={() => setScreen("cart")}
      />
      {detail}
    </>
  );
}
