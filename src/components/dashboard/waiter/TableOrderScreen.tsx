"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { formatMoney } from "@/lib/format";
import { priceCart, type CartPromo } from "@/lib/pricing";

import ItemDetailScreen from "@/components/customer/ItemDetailScreen";
import ComboDetailScreen from "@/components/customer/ComboDetailScreen";
import CartLineRow from "@/components/customer/CartLineRow";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { DietaryTagsProvider } from "@/components/DietaryTagsContext";
import type { CartItem } from "@/hooks/useCart";
import type { Combo } from "@/lib/promotions";
import type { StoredDietaryTag } from "@/lib/dietary";
import type { Category, MenuItem, Restaurant } from "@/lib/types";

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
  const t = useT();
  const toast = useToast();
  const router = useRouter();

  const [tableId, setTableId] = useState("");
  const [lines, setLines] = useState<CartItem[]>([]);
  const [editing, setEditing] = useState<CartItem | null>(null);
  const [openItem, setOpenItem] = useState<MenuItem | null>(null);
  const [openCombo, setOpenCombo] = useState<Combo | null>(null);
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ code: string; table: string } | null>(null);
  const nextCartId = useRef(1);

  const money = (n: number) => formatMoney(n, restaurant.currency);

  // The same quote the server re-runs from the database. No tip: a tip is
  // decided when somebody pays, and nobody is paying yet.
  const pricing = useMemo(
    () => priceCart({
      items: lines,
      servicePct: Number(restaurant.service_pct) || 0,
      serviceEnabled: Boolean(restaurant.service_enabled),
      promos,
    }),
    [lines, restaurant.service_pct, restaurant.service_enabled, promos],
  );

  const needle = search.trim().toLowerCase();
  const onPad = items;
  const sections = new Map<string, { name: string; dishes: typeof onPad }>();
  for (const category of categories) {
    const dishes = onPad.filter(i => i.category_id === category.id);
    if (dishes.length === 0) continue;
    const key = category.name.trim().toLowerCase();
    const already = sections.get(key);
    if (already) already.dishes = [...already.dishes, ...dishes];
    else sections.set(key, { name: category.name, dishes });
  }
  const byCategory = [...sections.values()]
    .map(s => ({
      name: s.name,
      dishes: needle ? s.dishes.filter(d => d.name.toLowerCase().includes(needle)) : s.dishes,
    }))
    .filter(s => s.dishes.length > 0);
  const sectionId = (name: string) => `pad-${name.trim().toLowerCase().replace(/\s+/g, "-")}`;

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

  /** Send it to the kitchen, owing. */
  async function send(): Promise<void> {
    if (busy || lines.length === 0 || !tableId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/table-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId, items: lines, note: note.trim() || undefined }),
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
      setSent({ code: data.code, table: data.table });
      setLines([]);
      setNote("");
      // The board and the badges have a new ticket to show.
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
              {t("waiter.title")}
            </h1>
          </header>

          {closedNow && <p className="tt-offline-banner">{t("pos.closedNow")}</p>}

          <div className="tt-pos">
            <div className={`tt-pos-menu ${busy ? "tt-pos-menu-sending" : ""}`} aria-busy={busy}>
              <input
                className="tt-input tt-pos-search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t("pos.search")}
                aria-label={t("pos.search")}
              />

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
                <section id="pad-combos" className="tt-pos-section">
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

            <aside className="tt-pos-cart">
              <h3 className="tt-serif" style={{ marginTop: 0 }}>
                {t("waiter.order")}
              </h3>

              {/* Which table, before anything else. It is the one thing that
                  makes this order findable afterwards — on the board, on the
                  bill, and in the history search. */}
              <label className="tt-field">
                <span className="tt-mod-label">{t("waiter.table")}</span>
                <select
                  className="tt-input"
                  value={tableId}
                  onChange={e => setTableId(e.target.value)}
                  disabled={busy}
                >
                  <option value="">{t("waiter.pickTable")}</option>
                  {tables.map(x => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>

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

              <label className="tt-field">
                <span className="tt-mod-label">{t("pos.note")}</span>
                <input
                  className="tt-input"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder={t("pos.noteHint")}
                  disabled={busy}
                />
              </label>

              <div className="tt-pos-total">
                <span>{t("pos.total")}</span>
                <strong>{money(pricing.total)}</strong>
              </div>

              {/* Nothing is charged here. The table settles at the end, which
                  is what the bill screen is for. */}
              <p className="tt-muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
                {t("waiter.paysLater")}
              </p>

              <div className="tt-pos-charge">
                <button
                  type="button"
                  className="tt-btn tt-btn-primary"
                  disabled={busy || closedNow || lines.length === 0 || !tableId}
                  onClick={() => void send()}
                >
                  {busy ? t("cart.placingOrder") : t("waiter.send")}
                </button>
              </div>
            </aside>
          </div>
        </div>

        {openItem && (
          <div className="tt-detail-overlay" onClick={() => setOpenItem(null)}>
            <div className="tt-detail-panel" onClick={e => e.stopPropagation()}>
              <DietaryTagsProvider tags={dietaryTags}>
                <ItemDetailScreen
                  item={openItem}
                  currency={restaurant.currency}
                  extras={extrasFor(openItem)}
                  onBack={() => setOpenItem(null)}
                  onAdd={line => {
                    setLines(prev => [...prev, { ...line, cartId: nextCartId.current++ }]);
                    setOpenItem(null);
                  }}
                />
              </DietaryTagsProvider>
            </div>
          </div>
        )}

        {editing && (
          <div className="tt-detail-overlay" onClick={() => setEditing(null)}>
            <div className="tt-detail-panel" onClick={e => e.stopPropagation()}>
              <DietaryTagsProvider tags={dietaryTags}>
                <ItemDetailScreen
                  item={items.find(i => i.id === editing.itemId) ?? (editing as unknown as MenuItem)}
                  currency={restaurant.currency}
                  extras={extrasFor(
                    items.find(i => i.id === editing.itemId) ?? (editing as unknown as MenuItem),
                  )}
                  initialLine={editing}
                  onBack={() => setEditing(null)}
                  onAdd={line => {
                    setLines(prev =>
                      prev.map(l => (l.cartId === editing.cartId ? { ...line, cartId: l.cartId } : l)),
                    );
                    setEditing(null);
                  }}
                />
              </DietaryTagsProvider>
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

        {/* Sent. The kitchen has it; the table owes for it. */}
        {sent && (
          <div className="tt-detail-overlay" onClick={() => setSent(null)}>
            <div className="tt-pos-ticket" onClick={e => e.stopPropagation()}>
              <p className="tt-pos-ticket-said">{t("waiter.sentTitle")}</p>
              <p className="tt-pos-code">{sent.code}</p>
              <p className="tt-pos-ticket-total">{t("dash.tableN", { label: sent.table })}</p>
              <p className="tt-muted tt-pos-ticket-hint">{t("waiter.sentHint")}</p>
              <button type="button" className="tt-btn tt-btn-primary" autoFocus onClick={() => setSent(null)}>
                {t("waiter.next")}
              </button>
            </div>
          </div>
        )}
      </div>
    </ConfirmProvider>
  );
}
