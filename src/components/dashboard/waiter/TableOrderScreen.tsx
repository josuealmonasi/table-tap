"use client";

import { useMemo, useRef, useState } from "react";
import { useRetryIntent } from "@/hooks/useRetryIntent";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";
import { shortMessage } from "@/lib/stock-message";
import { useToast } from "@/components/ui/Toast";
import { priceCart, type CartPromo } from "@/lib/pricing";
import ItemDetailScreen from "@/components/customer/ItemDetailScreen";
import ComboDetailScreen from "@/components/customer/ComboDetailScreen";
import DetailOverlay from "@/components/customer/DetailOverlay";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { DietaryTagsProvider } from "@/components/DietaryTagsContext";
import type { CartItem } from "@/hooks/useCart";
import { useLiveStock } from "@/hooks/useLiveStock";
import { usePosCart } from "@/hooks/usePosCart";
import { posSections } from "@/lib/pos-sections";
import PosMenu from "@/components/dashboard/pos/PosMenu";
import type { Combo } from "@/lib/promotions";
import type { StoredDietaryTag } from "@/lib/dietary";
import type { Category, MenuItem, Restaurant } from "@/lib/types";
import PadOrderPanel from "./PadOrderPanel";
import PadSentModal from "./PadSentModal";

/**
 * The waiter's order pad.
 *
 * The same menu the till shows, taken the same way — but nobody is paying. A
 * table that a waiter is standing at settles at the end, so this sends the
 * order to the kitchen owing, and the money is asked for later by whoever is
 * holding the bill.
 *
 * It shares the diner's own dish screen rather than asking for the order a
 * second way: the modifiers, the extras, this item's own special request. A
 * waiter is writing down the same order a diner would type, and asking it
 * differently is how one dish ends up with "less onion" and another in the
 * same round has nowhere to say "extra onion".
 *
 * Nothing reaches the server until the order is sent, so a pad abandoned
 * half-written leaves nothing behind and holds no stock.
 */
export default function TableOrderScreen({
  restaurant,
  categories,
  items,
  extras,
  extrasByProduct,
  promos,
  combos,
  closedNow,
  dietaryTags,
  tables,
}: {
  restaurant: Restaurant;
  categories: Category[];
  items: MenuItem[];
  extras: MenuItem[];
  extrasByProduct: Record<string, string[]>;
  promos: CartPromo[];
  combos: Combo[];
  closedNow: boolean;
  dietaryTags: StoredDietaryTag[];
  /** The tables this restaurant has. A waiter picks; they never invent one. */
  tables: { id: string; label: string }[];
}) {
  const attempt = useRetryIntent();
  const inFlight = useRef(false);
  const reviewedTotal = useRef(0);
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  // The counter sells the same dishes; the counts here follow the kitchen.
  useLiveStock(restaurant.id);

  const [tableId, setTableId] = useState("");
  // Not kept across a reload, as it never was: the pad is not the till.
  const cart = usePosCart(restaurant.id, false);
  const { lines } = cart;
  const [editing, setEditing] = useState<CartItem | null>(null);
  const [openItem, setOpenItem] = useState<MenuItem | null>(null);
  const [openCombo, setOpenCombo] = useState<Combo | null>(null);
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ code: string; table: string } | null>(null);
  /**
   * The pad is not to be typed into.
   *
   * While the order is in flight, unanswered, or its confirmation is still up:
   * `busy` goes false the instant the route answers, and the board behind is
   * still repainting from `router.refresh()`. A dish tapped into that gap
   * lands in a pad the waiter believes they have already sent.
   */
  const pending = attempt.pending();
  const frozen = attempt.frozen<{ tableId: string; items: CartItem[]; note?: string }>();
  const sending = busy || sent !== null || pending;

  // The same quote the server re-runs from the database. No tip: a tip is
  // decided when somebody pays, and nobody is paying yet.
  const pricing = useMemo(
    () =>
      priceCart({
        items: lines,
        servicePct: Number(restaurant.service_pct) || 0,
        serviceEnabled: Boolean(restaurant.service_enabled),
        promos,
      }),
    [lines, restaurant.service_pct, restaurant.service_enabled, promos],
  );

  const sections = posSections(categories, items, search);

  function extrasFor(item: MenuItem): MenuItem[] {
    return (extrasByProduct[item.id] ?? [])
      .map(id => extras.find(e => e.id === id))
      .filter((e): e is MenuItem => Boolean(e?.available));
  }

  /** Send it to the kitchen, owing. */
  async function send(): Promise<void> {
    if (inFlight.current || busy || (!attempt.pending() && (lines.length === 0 || !tableId))) return;
    if (!attempt.pending()) reviewedTotal.current = pricing.total;
    inFlight.current = true;
    setBusy(true);
    try {
      const res = await fetch("/api/table-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: attempt.body({ tableId, items: lines, note: note.trim() || undefined }),
      });
      const data = await res.json();
      if ((res.ok && data.orderId) || (!res.ok && attempt.settles(res.status))) attempt.clear();
      if (!res.ok) {
        if (data.code === "outOfStock") {
          // With the numbers in it. The refusal has always known how many are
          // left and every screen dropped them, so the answer to "how many can
          // I have then?" was a trip to the kitchen.
          toast(shortMessage(data.short ?? [], t), "error");
        } else {
          toast(data.error ?? t("done.networkError"), "error");
        }
        return;
      }
      if (!data.orderId) throw new Error("Missing order result");
      setSent({ code: data.code, table: data.table });
      cart.clear();
      setNote("");
      // The board and the badges have a new ticket to show.
      router.refresh();
    } catch {
      toast(t("done.networkError"), "error");
    } finally {
      inFlight.current = false;
      attempt.ended();
      setBusy(false);
    }
  }

  const edited = editing
    ? (items.find(i => i.id === editing.itemId) ?? (editing as unknown as MenuItem))
    : null;

  return (
    <ConfirmProvider>
      <div className="tt-dash">
        <div className="container">
          <header className="tt-dash-head">
            <h1 className="tt-serif" style={{ margin: 0 }}>
              {t("waiter.title")}
            </h1>
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
            <PadOrderPanel
              restaurantId={restaurant.id}
              currency={restaurant.currency}
              tables={tables}
              tableId={frozen?.tableId ?? tableId}
              onTable={setTableId}
              lines={frozen?.items ?? lines}
              items={items}
              note={frozen?.note ?? note}
              onNote={setNote}
              total={pending ? reviewedTotal.current : pricing.total}
              sending={sending}
              busy={busy}
              pending={attempt.unconfirmed()}
              onDiscard={() => { if (!inFlight.current) attempt.clear(); }}
              closedNow={closedNow}
              onChangeQty={(id, qty) => { if (!sending) cart.changeQty(id, qty); }}
              onEdit={line => { if (!sending) setEditing(line); }}
              onSend={() => void send()}
            />
          </div>
        </div>

        {openItem && (
          <DetailOverlay label={openItem.name} onClose={() => setOpenItem(null)}>
            <DietaryTagsProvider tags={dietaryTags}>
              <ItemDetailScreen
                item={openItem}
                currency={restaurant.currency}
                extras={extrasFor(openItem)}
                onBack={() => setOpenItem(null)}
                onAdd={line => {
                  if (!sending) cart.add(line);
                  setOpenItem(null);
                }}
              />
            </DietaryTagsProvider>
          </DetailOverlay>
        )}

        {editing && edited && (
          <DetailOverlay label={edited.name} onClose={() => setEditing(null)}>
            <DietaryTagsProvider tags={dietaryTags}>
              <ItemDetailScreen
                item={edited}
                currency={restaurant.currency}
                extras={extrasFor(edited)}
                initialLine={editing}
                onBack={() => setEditing(null)}
                onAdd={line => {
                  if (!sending) cart.replace(editing.cartId, line);
                  setEditing(null);
                }}
              />
            </DietaryTagsProvider>
          </DetailOverlay>
        )}

        {openCombo && (
          <DetailOverlay label={openCombo.name} onClose={() => setOpenCombo(null)}>
            <DietaryTagsProvider tags={dietaryTags}>
              <ComboDetailScreen
                combo={openCombo}
                currency={restaurant.currency}
                itemsById={new Map(items.map(i => [i.id, i]))}
                extrasById={new Map(extras.map(e => [e.id, e]))}
                extrasByProduct={extrasByProduct}
                onBack={() => setOpenCombo(null)}
                onAdd={line => {
                  if (!sending) cart.add(line);
                  setOpenCombo(null);
                }}
              />
            </DietaryTagsProvider>
          </DetailOverlay>
        )}

        <PadSentModal sent={sent} onClose={() => setSent(null)} />
      </div>
    </ConfirmProvider>
  );
}
