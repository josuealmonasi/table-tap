"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n/context";
import type { Category, MenuItem } from "@/lib/types";

/**
 * Type-to-find product picker for the promotion forms. A menu can run to
 * hundreds of products, so listing them all as chips doesn't scale — this
 * searches by product name AND category name ("coff" finds Coffee, and also
 * everything in a Coffee Drinks category), groups results by category, and
 * adds the chosen product to the promotion.
 *
 * Already-picked products are filtered out, so the list only ever offers
 * something that would actually change the promotion.
 */
export default function ProductPicker({
  products,
  categories,
  currency,
  pickedIds,
  onPick,
}: {
  products: MenuItem[];
  categories: Category[];
  currency: string;
  /** Products already in the promotion — hidden from the results. */
  pickedIds: string[];
  onPick: (product: MenuItem) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const categoryName = useMemo(() => {
    const map = new Map(categories.map(c => [c.id, c.name]));
    return (id: string | null) => (id ? (map.get(id) ?? "") : "");
  }, [categories]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const available = products.filter(p => !pickedIds.includes(p.id));
    const hits = q
      ? available.filter(
          p =>
            p.name.toLowerCase().includes(q) ||
            categoryName(p.category_id).toLowerCase().includes(q),
        )
      : available;
    return hits.slice(0, 40); // keep the list navigable on a huge menu
  }, [products, pickedIds, query, categoryName]);

  // Reset the highlight whenever the result set changes under it.
  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function choose(p: MenuItem) {
    onPick(p);
    setQuery("");
    setActive(0);
    // Stay open so several products can be added in a row.
    setOpen(true);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive(i => {
        const next = e.key === "ArrowDown" ? i + 1 : i - 1;
        return Math.max(0, Math.min(matches.length - 1, next));
      });
      return;
    }
    if (e.key === "Enter" && open && matches[active]) {
      e.preventDefault();
      choose(matches[active]);
    }
  }

  return (
    <div className="tt-picker" ref={boxRef}>
      <input
        className="tt-input"
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls="tt-picker-list"
        aria-autocomplete="list"
        placeholder={t("promos.searchProducts")}
        value={query}
        onChange={e => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {open && (
        <div className="tt-picker-menu" id="tt-picker-list" role="listbox">
          {matches.length === 0 ? (
            <p className="tt-muted tt-picker-empty">
              {query.trim() ? t("promos.noProductMatch") : t("promos.allPicked")}
            </p>
          ) : (
            matches.map((p, i) => (
              <button
                type="button"
                key={p.id}
                role="option"
                aria-selected={i === active}
                className={`tt-picker-option ${i === active ? "tt-picker-active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(p)}
              >
                <span className="tt-picker-name">
                  {p.emoji} {p.name}
                </span>
                <span className="tt-picker-meta">
                  {categoryName(p.category_id) && (
                    <span className="tt-picker-cat">{categoryName(p.category_id)}</span>
                  )}
                  {formatMoney(Number(p.price), currency)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
