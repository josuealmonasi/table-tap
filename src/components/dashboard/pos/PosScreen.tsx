"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/format";
import { CheckIcon } from "@/components/ui/icons";
import { priceCart } from "@/lib/pricing";
import { printableReceipt } from "@/lib/print-document";

import ItemDetailScreen from "@/components/customer/ItemDetailScreen";
import CartLineRow from "@/components/customer/CartLineRow";
import TipPicker from "@/components/customer/TipPicker";
import ComboDetailScreen from "@/components/customer/ComboDetailScreen";
import type { Combo } from "@/lib/promotions";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import type { CartItem } from "@/hooks/useCart";
import { DietaryTagsProvider } from "@/components/DietaryTagsContext";
import type { StoredDietaryTag } from "@/lib/dietary";
import type { Category, MenuItem, Restaurant } from "@/lib/types";
import type { CartPromo } from "@/lib/pricing";

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
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();

  const [lines, setLines] = useState<CartItem[]>([]);
  const [restored, setRestored] = useState(false);
  const [editing, setEditing] = useState<CartItem | null>(null);
  const nextCartId = useRef(1);
  const [customerName, setCustomerName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [openItem, setOpenItem] = useState<MenuItem | null>(null);
  const [openCombo, setOpenCombo] = useState<Combo | null>(null);
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  // The customer waved the ticket away. Very common on a sale that is handed
  // over as it is rung up — a bottle of water does not need paperwork — and
  // the till should not print one nobody is going to take.
  const [noTicket, setNoTicket] = useState(false);
  const [ticket, setTicket] = useState<{
    code: string;
    total: number;
    /** Nothing to make: it went in their hand, not on the pass. */
    handedOver: boolean;
  } | null>(null);
  const [pending, setPending] = useState<"cash" | "card" | null>(null);
  const [tipPct, setTipPct] = useState(0);
  const [tipCustom, setTipCustom] = useState<number | null>(null);

  const money = (n: number) => formatMoney(n, restaurant.currency);

  /**
   * A half-rung sale survives a reload.
   *
   * A counter is the worst place to lose one: the customer is standing there,
   * the cashier has already read six items back to them, and a stray refresh
   * or a tablet reloading itself meant starting the whole order again. Nothing
   * of this reaches the server — it is the same cart, on the same device,
   * waiting to be charged.
   */
  const storageKey = `tt-pos-cart:${restaurant.id}`;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setLines(parsed as CartItem[]);
          nextCartId.current =
            Math.max(0, ...(parsed as CartItem[]).map(l => l.cartId ?? 0)) + 1;
        }
      }
    } catch {
      // A browser that will not give us storage still sells; it just cannot
      // hold a sale across a reload.
    }
    setRestored(true);
  }, [storageKey]);

  useEffect(() => {
    // Not before the restore has run, or an empty first render would wipe it.
    if (!restored) return;
    try {
      if (lines.length === 0) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, JSON.stringify(lines));
    } catch {
      // Nothing to do, and nothing worth interrupting a sale for.
    }
  }, [lines, restored, storageKey]);

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
    [lines, promos, restaurant.service_pct, restaurant.service_enabled, tipPct, tipCustom],
  );

  // Grouped by the name on the heading, not by the row id. A restaurant with a
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

  // lunch menu and a dinner menu has a Starters in each, and listing "STARTERS"
  // twice tells a cashier nothing about which is which — they are the same
  // section of the same counter.
  // Sold-out dishes stay on the till, unlike the diner's menu which hides
  // them. A cashier is standing in front of somebody who just asked for one,
  // and "it is not on my screen" is not an answer — "we've run out of that"
  // is. Shown, marked, and not orderable.
  const onTill = items;
  const sections = new Map<string, { name: string; dishes: typeof onTill }>();
  for (const category of categories) {
    const dishes = onTill.filter(i => i.category_id === category.id);
    if (dishes.length === 0) continue;
    const key = category.name.trim().toLowerCase();
    const existing = sections.get(key);
    if (existing) existing.dishes = [...existing.dishes, ...dishes];
    else sections.set(key, { name: category.name, dishes });
  }
  const needle = search.trim().toLowerCase();
  const byCategory = [...sections.values()]
    .map(sec => ({
      ...sec,
      dishes: needle ? sec.dishes.filter(d => d.name.toLowerCase().includes(needle)) : sec.dishes,
    }))
    .filter(sec => sec.dishes.length > 0);

  /** A heading's own id, so a chip can jump to it and scrolling still works. */
  const sectionId = (name: string) => `pos-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  /** Extras this dish offers, resolved from the ids the menu stores. */
  function extrasFor(item: MenuItem): MenuItem[] {
    return (extrasByProduct[item.id] ?? [])
      .map(id => extras.find(e => e.id === id))
      .filter((e): e is MenuItem => Boolean(e?.available));
  }

  function changeQty(cartId: number, qty: number): void {
    setLines(prev =>
      qty <= 0
        ? prev.filter(l => l.cartId !== cartId)
        : prev.map(l => (l.cartId === cartId ? { ...l, qty: Math.min(qty, 99) } : l)),
    );
  }

  /**
   * Prints the ticket when nobody asked for it by email.
   *
   * Through the browser's own print dialog, which means any printer the
   * counter machine can already see — USB, Ethernet, AirPrint — works with
   * nothing to integrate. Chrome started with `--kiosk-printing` puts it on
   * the roll with no dialog at all, which is what a counter actually wants.
   *
   * The receipt itself is the server's, unchanged: the same document that goes
   * in the email. `printableReceipt` only describes the paper — an 80mm page
   * with the screen's greys pushed to black — so a printed ticket cannot drift
   * away from an emailed one.
   */
  function printReceipt(html: string): void {
    const w = window.open("", "_blank", "width=380,height=640");
    if (!w) {
      // A blocked pop-up must not look like a printed ticket.
      toast(t("pos.printBlocked"), "error");
      return;
    }
    w.document.write(printableReceipt(html, restaurant.name));
    w.document.close();
    w.focus();
  }

  /** Ring it up. The money is already in the drawer by the time this runs. */
  async function charge(method: "cash" | "card"): Promise<void> {
    if (lines.length === 0 || busy) return;
    setPending(null);
    setBusy(true);
    try {
      const res = await fetch("/api/pos/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // One reference per sale, so a request sent twice cannot charge
          // twice or put two tickets on the pass.
          posRef: crypto.randomUUID(),
          items: lines,
          method,
          customerName: customerName.trim() || undefined,
          note: note.trim() || undefined,
          tipPct: tipCustom === null ? tipPct : undefined,
          tipAmount: tipCustom ?? undefined,
          email: canEmailReceipt && !noTicket ? email.trim() || undefined : undefined,
          noReceipt: noTicket || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === "outOfStock") {
          const names = (data.short ?? []).map((s: { name: string }) => s.name).join(", ");
          toast(t("pos.outOfStock", { names }), "error");
        } else {
          toast(data.error ?? t("done.networkError"), "error");
        }
        return;
      }
      if (data.receipt === "failed") toast(t("pos.receiptFailed"), "error");
      else if (data.receipt === "sent") toast(t("pos.receiptSent"));
      // No address, or an address the mail never reached: it prints.
      if (data.receiptHtml) printReceipt(data.receiptHtml);
      setTicket({ code: data.code, total: data.total, handedOver: Boolean(data.handedOver) });
      setLines([]);
      setCustomerName("");
      setEmail("");
      setNote("");
      setNoTicket(false);
      setTipPct(0);
      setTipCustom(null);
      // The kitchen board and the badges have a new ticket to show.
      router.refresh();
    } catch {
      toast(t("done.networkError"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmProvider>
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <h1 className="tt-serif" style={{ margin: 0 }}>
            {t("pos.title")}
          </h1>
        </header>

        {closedNow && <p className="tt-offline-banner">{t("pos.closedNow")}</p>}

        <div className="tt-pos">
          {/* What is for sale, by section, one tap to add. */}
          <div className={`tt-pos-menu ${busy ? "tt-pos-menu-sending" : ""}`} aria-busy={busy}>
            <input
              className="tt-input tt-pos-search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("pos.search")}
              aria-label={t("pos.search")}
            />

            {/* Jumps to a section without hiding the rest: a cashier who knows
                where a dish is goes straight there, and one who does not can
                still scroll past everything the way they always could. */}
            {byCategory.length > 1 && (
              <nav className="tt-pos-jump" aria-label={t("pos.sections")}>
                {byCategory.map(({ name }) => (
                  <button
                    type="button"
                    key={name}
                    onClick={() =>
                      document
                        .getElementById(sectionId(name))
                        ?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }
                  >
                    {name}
                  </button>
                ))}
              </nav>
            )}

            {combos.length > 0 && !needle && (
              <section id="pos-combos" className="tt-pos-section">
                <h3 className="tt-pos-cat">{t("menu.deals")}</h3>
                <div className="tt-pos-grid">
                  {combos.map(combo => (
                    <button
                      type="button"
                      key={combo.id}
                      className="tt-pos-tile"
                      onClick={() => setOpenCombo(combo)}
                    >
                      <span className="tt-pos-tile-name">{combo.name}</span>
                      <span className="tt-pos-tile-price">{money(combo.price)}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {byCategory.map(({ name, dishes }) => (
              <section key={name} id={sectionId(name)} className="tt-pos-section">
                <h3 className="tt-pos-cat">{name}</h3>
                <div className="tt-pos-grid">
                  {dishes.map(dish => (
                    <button
                      type="button"
                      key={dish.id}
                      className={`tt-pos-tile ${dish.available ? "" : "tt-pos-tile-out"}`}
                      disabled={!dish.available}
                      onClick={() => setOpenItem(dish)}
                    >
                      <span className="tt-pos-tile-name">
                        {dish.emoji} {dish.name}
                      </span>
                      {dish.available ? (
                        <span className="tt-pos-tile-price">{money(Number(dish.price))}</span>
                      ) : (
                        <span className="tt-badge tt-pos-tile-out-tag">{t("cart.soldOut")}</span>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            ))}
            {byCategory.length === 0 && <p className="tt-muted">{t("pos.noMatch")}</p>}
          </div>

          {/* The sale itself. */}
          <aside className="tt-pos-cart">
            <h3 className="tt-serif" style={{ marginTop: 0 }}>
              {t("pos.sale")}
            </h3>

            {lines.length === 0 ? (
              <p className="tt-muted">{t("pos.empty")}</p>
            ) : (
              <div className="tt-pos-lines">
                {lines.map(line => (
                  <CartLineRow
                    key={line.cartId}
                    item={line}
                    currency={restaurant.currency}
                    imageUrl={items.find(i => i.id === line.itemId)?.image_url ?? null}
                    onRemove={cartId => changeQty(cartId, 0)}
                    onChangeQty={changeQty}
                    onEdit={item => setEditing(item)}
                  />
                ))}
              </div>
            )}

            <div className="tt-pos-total">
              <span>{t("pos.total")}</span>
              <strong>{money(pricing.total)}</strong>
            </div>

            <div className="tt-pos-charge">
              <button
                type="button"
                className="tt-btn tt-btn-primary"
                disabled={busy || closedNow || lines.length === 0}
                onClick={() => setPending("cash")}
              >
                {t("pos.chargeCash")}
              </button>
              <button
                type="button"
                className="tt-btn tt-btn-primary"
                disabled={busy || closedNow || lines.length === 0}
                onClick={() => setPending("card")}
              >
                {t("pos.chargeCard")}
              </button>
            </div>
          </aside>
        </div>
      </div>

      {/* The same screen a diner uses to add a dish: the modifiers, the
          extras, THIS item's own special request, the quantity and the live
          price. A cashier is taking the same order over a counter, and asking
          it a second way is how one dish ends up with "less onion" and another
          in the same sale has nowhere to say "extra onion". */}
      {/* Who it is for, and where the receipt goes — asked once, at the moment
          the cashier is already speaking to them, and kept out of the sale
          panel where it was three fields of dead space on every sale.
          Both buttons send the order; the backdrop only closes, because an
          accidental click must never take money. */}
      {pending && (
        <div className="tt-detail-overlay" onClick={() => setPending(null)}>
          <div className="tt-pos-ask" onClick={e => e.stopPropagation()}>
            <h3 className="tt-serif" style={{ marginTop: 0 }}>
              {t("pos.askTitle", { amount: money(pricing.total) })}
            </h3>

            {/* The same chips a diner sees, so the two screens cannot offer
                different tips on the same menu. */}
            <div className="tt-pos-tip">
              <TipPicker
                currency={restaurant.currency}
                tipPct={tipCustom !== null ? 0 : tipPct}
                tipCustom={tipCustom}
                maxTip={pricing.subtotal}
                onPresetTip={pct => {
                  setTipCustom(null);
                  setTipPct(pct);
                }}
                onCustomTip={amount => {
                  setTipCustom(amount);
                  if (amount !== null) setTipPct(0);
                }}
              />
            </div>

            <label className="tt-field">
              <span className="tt-mod-label">{t("pos.customerName")}</span>
              <input
                className="tt-input"
                autoFocus
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                placeholder={t("pos.customerNameHint")}
              />
            </label>

            <label className="tt-field">
              <span className="tt-mod-label">{t("pos.note")}</span>
              <input
                className="tt-input"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder={t("pos.noteHint")}
              />
            </label>

            {/* Not a second way to pay — a modifier on the one there is. The
                customer said no thank you, so there is nowhere to send a
                receipt and nothing to print, and the address field goes away
                rather than sitting there asking a question that no longer has
                a point. */}
            <label className="tt-pos-noticket">
              <input
                type="checkbox"
                checked={noTicket}
                disabled={busy}
                onChange={e => setNoTicket(e.target.checked)}
              />
              <span>{t("pos.noTicket")}</span>
            </label>

            {noTicket ? (
              <p className="tt-muted" style={{ fontSize: 13, margin: "0 0 4px" }}>
                {t("pos.noTicketHint")}
              </p>
            ) : canEmailReceipt ? (
              <label className="tt-field">
                <span className="tt-mod-label">{t("pos.receiptEmail")}</span>
                <input
                  className="tt-input"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={t("pos.receiptEmailHint")}
                />
              </label>
            ) : (
              <p className="tt-muted" style={{ fontSize: 13 }}>
                {t("pos.receiptPrintOnly")}
              </p>
            )}

            {/* One way forward. Filled in or left blank, this sends the order —
                a second button offering the same thing with a different name
                is a choice nobody has to make. Clicking outside closes and
                changes nothing, so a stray click never takes money. */}
            <div className="tt-pos-ask-actions">
              <button
                type="button"
                className="tt-btn tt-btn-primary"
                disabled={busy}
                onClick={() => void charge(pending)}
              >
                {busy
                  ? t("cart.placingOrder")
                  : allHandedOver
                    ? t("pos.finishSale")
                    : t("pos.sendToKitchen")}
              </button>
            </div>
          </div>
        </div>
      )}

      {openCombo && (
        <div className="tt-detail-overlay" onClick={() => setOpenCombo(null)}>
          <div className="tt-detail-panel" onClick={e => e.stopPropagation()}>
            <DietaryTagsProvider tags={dietaryTags}>
              <ComboDetailScreen
                combo={openCombo}
                currency={restaurant.currency}
                itemsById={new Map(items.map(i => [i.id, i]))}
                extrasById={new Map(extras.map(e => [e.id, e]))}
                extrasByProduct={extrasByProduct}
                onBack={() => setOpenCombo(null)}
                onAdd={line => {
                  setLines(prev => [...prev, { ...line, cartId: nextCartId.current++ }]);
                  setOpenCombo(null);
                }}
              />
            </DietaryTagsProvider>
          </div>
        </div>
      )}

      {/* Charged. Shown over the till rather than instead of it — the menu is
          still there, and the next customer is already at the counter. */}
      {ticket && (
        <div className="tt-detail-overlay" onClick={() => setTicket(null)}>
          <div className="tt-pos-ticket" onClick={e => e.stopPropagation()}>
            <span className="tt-pos-ticket-mark" aria-hidden="true">
              <CheckIcon size={26} weight="bold" />
            </span>
            <p className="tt-pos-ticket-said">{t("pos.charged")}</p>
            <p className="tt-pos-code">{ticket.code}</p>
            <p className="tt-pos-ticket-total">{money(ticket.total)}</p>
            {/* Telling a cashier to call somebody who is still standing there
                with their drink in their hand is the screen not knowing what
                just happened. */}
            <p className="tt-muted tt-pos-ticket-hint">
              {ticket.handedOver ? t("pos.handedOver") : t("pos.calledOut")}
            </p>
            <button
              type="button"
              className="tt-btn tt-btn-primary"
              autoFocus
              onClick={() => setTicket(null)}
            >
              {t("pos.newSale")}
            </button>
          </div>
        </div>
      )}

      {/* The diner's own dish screen, in the diner's own panel: the modifiers,
          the extras, THIS item's special request, the quantity and the live
          price. A cashier is taking the same order over a counter. */}
      {(openItem || editing) && (
        <div
          className="tt-detail-overlay"
          onClick={() => {
            setOpenItem(null);
            setEditing(null);
          }}
        >
          <div className="tt-detail-panel" onClick={e => e.stopPropagation()}>
            <DietaryTagsProvider tags={dietaryTags}>
              <ItemDetailScreen
                item={editing ? items.find(i => i.id === editing.itemId)! : openItem!}
                extras={extrasFor(editing ? items.find(i => i.id === editing.itemId)! : openItem!)}
                currency={restaurant.currency}
                initialLine={editing ?? undefined}
                onBack={() => {
                  setOpenItem(null);
                  setEditing(null);
                }}
                onAdd={line => {
                  if (editing) {
                    setLines(prev =>
                      prev.map(l => (l.cartId === editing.cartId ? { ...line, cartId: l.cartId } : l)),
                    );
                    setEditing(null);
                  } else {
                    setLines(prev => [...prev, { ...line, cartId: nextCartId.current++ }]);
                    setOpenItem(null);
                  }
                }}
                inCartQty={lines
                  .filter(l => l.itemId === (editing?.itemId ?? openItem?.id))
                  .reduce((n, l) => n + l.qty, 0)}
              />
            </DietaryTagsProvider>
          </div>
        </div>
      )}
    </div>
    </ConfirmProvider>
  );
}
