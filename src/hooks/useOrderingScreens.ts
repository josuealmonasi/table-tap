"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { MenuItem, OrderLineItem } from "@/lib/types";
import type { Combo } from "@/lib/promotions";
import type { CartItem, useCart } from "@/hooks/useCart";
import { readMenuParams, syncMenuUrl } from "@/lib/menu-params";

export type Screen = "menu" | "item" | "combo" | "edit" | "cart";

/**
 * Which screen of the diner's app is showing, and what it is showing: the
 * menu, a dish, a combo, a cart line being edited, the cart.
 *
 * The dish and the combo are mirrored into the URL, so a link shares them and
 * a reload brings them back.
 */
export function useOrderingScreens(
  cart: ReturnType<typeof useCart>,
  items: MenuItem[],
  combos: Combo[],
) {
  const [screen, setScreen] = useState<Screen>("menu");
  const [selected, setSelected] = useState<MenuItem | null>(null);
  // Where the dish screen was opened from, so backing out or adding returns
  // there. A suggestion is taken from the cart, and dropping that diner on the
  // menu afterwards makes them find their way back to the order they were
  // about to place.
  const [detailFrom, setDetailFrom] = useState<Screen>("menu");
  const [selectedCombo, setSelectedCombo] = useState<Combo | null>(null);
  const [editingLine, setEditingLine] = useState<CartItem | null>(null);

  const sharedParams = readMenuParams(new URLSearchParams(useSearchParams().toString()));
  const sharedItemId = sharedParams.item;
  const sharedComboId = sharedParams.combo;

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

  // Same for ?combo=<id>. Reloading with a combo open used to drop you back on
  // the menu and lose whatever had been configured in it; now the dialog comes
  // back. A combo that's been paused or had a component go unavailable isn't
  // in `combos` at all, so the menu is the right landing.
  useEffect(() => {
    if (!sharedComboId) return;
    const shared = combos.find(c => c.id === sharedComboId);
    if (!shared) {
      syncMenuUrl({ combo: null });
      return;
    }
    setSelectedCombo(shared);
    setScreen("combo");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape closes the dish detail. It reads as a dialog on desktop, and a
  // dialog that only closes via its own back arrow is a dead end for anyone
  // on a keyboard.
  useEffect(() => {
    if (screen !== "item" && screen !== "edit" && screen !== "combo") return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (screen === "combo") closeCombo();
      else closeDetail(screen === "edit" ? "cart" : detailFrom);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, detailFrom]);

  function openItem(item: MenuItem, from: Screen = "menu") {
    setDetailFrom(from);
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
    setScreen(detailFrom);
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
    syncMenuUrl({ combo: combo.id });
  }

  function closeCombo() {
    setSelectedCombo(null);
    setScreen("menu");
    syncMenuUrl({ combo: null });
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

  /** A dish added from the detail, or a cart line saved back after editing. */
  function saveDish(line: OrderLineItem) {
    if (screen === "edit" && editingLine) {
      cart.updateItem(editingLine.cartId, line);
      setEditingLine(null);
      closeDetail("cart");
      return;
    }
    addToCart(line);
  }

  return {
    screen,
    setScreen,
    selected,
    detailFrom,
    selectedCombo,
    editingLine,
    openItem,
    closeDetail,
    openCombo,
    closeCombo,
    addConfiguredCombo,
    editLine,
    saveDish,
  };
}
