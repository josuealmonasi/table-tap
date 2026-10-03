"use client";

import { useMemo } from "react";
import type { MenuItem } from "@/lib/types";
import type { CartPromo } from "@/lib/pricing";
import type { CartItem } from "@/hooks/useCart";
import type { useOrderingScreens } from "@/hooks/useOrderingScreens";
import DetailOverlay from "./DetailOverlay";
import ItemDetailScreen from "./ItemDetailScreen";
import ComboDetailScreen from "./ComboDetailScreen";

interface DishOverlaysProps {
  screens: ReturnType<typeof useOrderingScreens>;
  currency: string;
  promos: CartPromo[];
  cartItems: CartItem[];
  items: MenuItem[];
  extras: MenuItem[];
  extrasByProduct: Record<string, string[]>;
}

/**
 * The dish detail and the combo builder, layered over whatever screen opened
 * them — the menu when adding, the cart when editing a line.
 *
 * The detail used to replace that screen outright. On a phone that's right
 * and looks identical to before, but on a wide screen it meant a full-page
 * takeover for one dish: the customer lost their place in the list and read a
 * short form stretched across an otherwise empty page. Keeping the list
 * mounted behind a dialog is both less jarring and a shorter trip back.
 */
export default function DishOverlays({
  screens,
  currency,
  promos,
  cartItems,
  items,
  extras,
  extrasByProduct,
}: DishOverlaysProps) {
  const { screen, selected, detailFrom, editingLine, selectedCombo } = screens;
  const extrasById = useMemo(() => new Map(extras.map(e => [e.id, e])), [extras]);
  const itemsById = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);

  // The available extra items offered by the currently selected product.
  const selectedExtras = useMemo(() => {
    if (!selected) return [];
    return (extrasByProduct[selected.id] ?? [])
      .map(id => extrasById.get(id))
      .filter((e): e is MenuItem => Boolean(e));
  }, [selected, extrasByProduct, extrasById]);

  const closeDetail = () => screens.closeDetail(screen === "edit" ? "cart" : detailFrom);

  return (
    <>
      {(screen === "item" || screen === "edit") && selected && (
        <DetailOverlay onClose={closeDetail}>
          <ItemDetailScreen
            item={selected}
            extras={selectedExtras}
            currency={currency}
            initialLine={screen === "edit" && editingLine ? editingLine : undefined}
            promo={promos.find(p => p.itemIds.includes(selected.id))}
            inCartQty={cartItems
              .filter(i => i.itemId === selected.id && !i.comboId)
              .reduce((n, i) => n + i.qty, 0)}
            onBack={closeDetail}
            onAdd={screens.saveDish}
          />
        </DetailOverlay>
      )}
      {screen === "combo" && selectedCombo && (
        <DetailOverlay onClose={screens.closeCombo}>
          <ComboDetailScreen
            combo={selectedCombo}
            currency={currency}
            itemsById={itemsById}
            extrasById={extrasById}
            extrasByProduct={extrasByProduct}
            onBack={screens.closeCombo}
            onAdd={screens.addConfiguredCombo}
          />
        </DetailOverlay>
      )}
    </>
  );
}
