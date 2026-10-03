"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";
import { useLiveStock } from "@/hooks/useLiveStock";
import ScanToCollect from "@/components/dashboard/ScanToCollect";
import StampCard from "@/components/dashboard/loyalty/StampCard";
import { priceCart } from "@/lib/pricing";
import ItemDetailScreen from "@/components/customer/ItemDetailScreen";
import ComboDetailScreen from "@/components/customer/ComboDetailScreen";
import DetailOverlay from "@/components/customer/DetailOverlay";
import type { Combo } from "@/lib/promotions";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import type { CartItem } from "@/hooks/useCart";
import { DietaryTagsProvider } from "@/components/DietaryTagsContext";
import type { StoredDietaryTag } from "@/lib/dietary";
import type { Category, MenuItem, Restaurant } from "@/lib/types";
import type { CartPromo } from "@/lib/pricing";
import { usePosCart } from "@/hooks/usePosCart";
import { usePosSaleDetails } from "@/hooks/usePosSaleDetails";
import { usePosCharge } from "@/hooks/usePosCharge";
import { posSections } from "@/lib/pos-sections";
import PosMenu from "./PosMenu";
import PosSalePanel from "./PosSalePanel";
import PosAsk from "./PosAsk";
import PosTicketModal from "./PosTicketModal";

/**
 * The counter till.
 *
 * A cashier builds the order in front of whoever is buying, takes the money,
 * and only then does anything reach the server: one request that creates the
 * order already paid and already on the pass. Nothing is written while the
 * cart is being built, so an order abandoned half-rung leaves nothing behind
 * and holds no stock.
 *
 * The total shown here runs the same `priceCart` the server re-runs from the
 * database. It is a quote, never the charge — the amount taken is whatever the
 * server prices, and the two agreeing is the point of sharing the function.
 */
export default function PosScreen({
  restaurant,
  categories,
  items,
  extras,
  extrasByProduct,
  promos,
  combos,
  closedNow,
  dietaryTags,
  canEmailReceipt,
  loyalty = false,
  canChargeAccount = false,
}: {
  restaurant: Restaurant;
  categories: Category[];
  items: MenuItem[];
  extras: MenuItem[];
  extrasByProduct: Record<string, string[]>;
  promos: CartPromo[];
  /** Bundles, sold at the counter the same way a diner buys one. */
  combos: Combo[];
  closedNow: boolean;
  /** The restaurant's own allergen list, for the dish screen. */
  dietaryTags: StoredDietaryTag[];
  /** False when no mail provider is configured — then emailing is not offered. */
  canEmailReceipt: boolean;
  /** The restaurant takes visit-card stamps right now: plan and program both. */
  loyalty?: boolean;
  /** The plan carries customer accounts: a sale can go on one. */
  canChargeAccount?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  // Two tills sell at once; the counts on the tiles follow the kitchen.
  useLiveStock(restaurant.id);

  const cart = usePosCart(restaurant.id);
  const { lines } = cart;
  const details = usePosSaleDetails();
  const { charge, busy, pending, setPending, ticket, setTicket } = usePosCharge({
    restaurant,
    cart,
    details,
    canEmailReceipt,
  });
  const [editing, setEditing] = useState<CartItem | null>(null);
  const [openItem, setOpenItem] = useState<MenuItem | null>(null);
  const [openCombo, setOpenCombo] = useState<Combo | null>(null);
  const [search, setSearch] = useState("");
  /**
   * The till is not to be typed into.
   *
   * While the sale is in flight, and while the ticket is still up: `busy` goes
   * false the instant the route answers, and a dish tapped into that gap lands
   * in a sale the cashier believes they have already rung up.
   */
  const sending = busy || ticket !== null;
  const { tipPct, tipCustom } = details;

  /** The same arithmetic the server will redo from the database. */
  const pricing = useMemo(
    () =>
      priceCart({
        items: lines,
        servicePct: restaurant.service_pct,
        serviceEnabled: restaurant.service_enabled,
        tipPct: tipCustom === null ? tipPct : 0,
        tipAmount: tipCustom ?? undefined,
        coupon: null,
        promos,
      }),
    [
      lines,
      promos,
      restaurant.service_pct,
      restaurant.service_enabled,
      tipPct,
      tipCustom,
    ],
  );

  // Whether this sale is finished the moment it is charged: everything in it
  // comes off a shelf, so it goes in the customer's hand rather than to a
  // cook. Worked out here from the menu the till was given, and decided again
  // on the server from the DB — the screen only needs it to word a button.
  const skipsKitchen = useMemo(() => {
    const byId = new Map(items.map(i => [i.id, i]));
    const flag = (id: string) => byId.get(id)?.skips_kitchen ?? false;
    return (line: CartItem) =>
      line.components?.length
        ? line.components.every(c => flag(c.itemId))
        : flag(line.itemId);
  }, [items]);
  const allHandedOver = lines.length > 0 && lines.every(skipsKitchen);

  const sections = posSections(categories, items, search);

  /** Extras this dish offers, resolved from the ids the menu stores. */
  function extrasFor(item: MenuItem): MenuItem[] {
    return (extrasByProduct[item.id] ?? [])
      .map(id => extras.find(e => e.id === id))
      .filter((e): e is MenuItem => Boolean(e?.available));
  }

  function closeDish(): void {
    setOpenItem(null);
    setEditing(null);
  }

  const dish = editing ? items.find(i => i.id === editing.itemId) : openItem;

  return (
    <ConfirmProvider>
      <div className="tt-dash">
        <div className="container">
          <header className="tt-dash-head">
            <h1 className="tt-serif" style={{ margin: 0 }}>
              {t("pos.title")}
            </h1>
            {/* The queue, not the till's own sale.
                Somebody who ordered from their phone arrives holding a code that
                says "the counter scans this and charges it". Until now the
                cashier had to leave the till, open Cuentas abiertas and find
                them — with a person waiting. The camera is here too now; the
                list over there is untouched and still works.

                It collects nowhere near here: the code names a bill, and the
                bill is settled on the screen that settles bills. One way for
                money to be taken, not two that have to agree. */}
            <div className="tt-pos-head-actions">
              <ScanToCollect
                onFound={id => router.push(`/dashboard/bills?order=${id}`)}
              />
              {loyalty && <StampCard />}
            </div>
          </header>

          {closedNow && <p className="tt-offline-banner">{t("pos.closedNow")}</p>}

          <div className="tt-pos">
            <PosMenu
              sections={sections}
              combos={combos}
              search={search}
              onSearch={setSearch}
              sending={sending}
              currency={restaurant.currency}
              onOpenItem={setOpenItem}
              onOpenCombo={setOpenCombo}
            />
            <PosSalePanel
              lines={lines}
              items={items}
              currency={restaurant.currency}
              total={pricing.total}
              accountAmount={Math.round((pricing.total - pricing.tip) * 100) / 100}
              locked={busy || closedNow || lines.length === 0}
              canChargeAccount={canChargeAccount}
              onChangeQty={cart.changeQty}
              onEdit={setEditing}
              onCharge={setPending}
              onChargeAccount={account => charge("account", account)}
            />
          </div>
        </div>

        {pending && (
          <PosAsk
            details={details}
            total={pricing.total}
            subtotal={pricing.subtotal}
            currency={restaurant.currency}
            canEmailReceipt={canEmailReceipt}
            busy={busy}
            allHandedOver={allHandedOver}
            onClose={() => setPending(null)}
            onSend={() => void charge(pending)}
          />
        )}

        {openCombo && (
          <DetailOverlay onClose={() => setOpenCombo(null)}>
            <DietaryTagsProvider tags={dietaryTags}>
              <ComboDetailScreen
                combo={openCombo}
                currency={restaurant.currency}
                itemsById={new Map(items.map(i => [i.id, i]))}
                extrasById={new Map(extras.map(e => [e.id, e]))}
                extrasByProduct={extrasByProduct}
                onBack={() => setOpenCombo(null)}
                onAdd={line => {
                  cart.add(line);
                  setOpenCombo(null);
                }}
              />
            </DietaryTagsProvider>
          </DetailOverlay>
        )}

        <PosTicketModal
          ticket={ticket}
          currency={restaurant.currency}
          onClose={() => setTicket(null)}
        />

        {/* The diner's own dish screen, in the diner's own panel: the modifiers,
            the extras, THIS item's special request, the quantity and the live
            price. A cashier is taking the same order over a counter, and asking
            it a second way is how one dish ends up with "less onion" and another
            in the same sale has nowhere to say "extra onion". */}
        {dish && (
          <DetailOverlay onClose={closeDish}>
            <DietaryTagsProvider tags={dietaryTags}>
              <ItemDetailScreen
                item={dish}
                extras={extrasFor(dish)}
                currency={restaurant.currency}
                initialLine={editing ?? undefined}
                onBack={closeDish}
                onAdd={line => {
                  if (editing) {
                    cart.replace(editing.cartId, line);
                    setEditing(null);
                  } else {
                    cart.add(line);
                    setOpenItem(null);
                  }
                }}
                inCartQty={lines
                  .filter(l => l.itemId === (editing?.itemId ?? openItem?.id))
                  .reduce((n, l) => n + l.qty, 0)}
              />
            </DietaryTagsProvider>
          </DetailOverlay>
        )}
      </div>
    </ConfirmProvider>
  );
}
