"use client";

import { formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n/context";
import type { MenuItem } from "@/lib/types";

/**
 * The products currently in a promotion, as chips. "+" adds another of the
 * same item, "−" takes one away and removes the chip at zero. Shared by the
 * combo and quantity-deal forms so both behave identically.
 */
export default function PickedProducts({
  label,
  emptyLabel,
  picked,
  products,
  currency,
  onBump,
  /** Quantity is meaningful for a combo, but not for a "2x1 on X" deal. */
  showQty = true,
}: {
  label: string;
  emptyLabel: string;
  picked: { id: string; qty: number }[];
  products: MenuItem[];
  currency: string;
  onBump: (id: string, delta: number) => void;
  showQty?: boolean;
}) {
  const t = useT();

  return (
    <div>
      <div className="tt-mod-label">{label}</div>
      {picked.length === 0 ? (
        <p className="tt-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
          {emptyLabel}
        </p>
      ) : (
        <div className="tt-chips">
          {picked.map(p => {
            const item = products.find(i => i.id === p.id);
            if (!item) return null;
            return (
              <span key={p.id} className="tt-chip tt-chip-on">
                <span>
                  {item.emoji} {item.name} · {formatMoney(Number(item.price), currency)}
                </span>
                {showQty && (
                  <>
                    <span className="tt-chip-qty">×{p.qty}</span>
                    <button
                      type="button"
                      className="tt-chip-btn"
                      aria-label={t("promos.addOne", { name: item.name })}
                      onClick={() => onBump(p.id, 1)}
                    >
                      +
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="tt-chip-btn tt-chip-remove"
                  aria-label={t("promos.removeOne", { name: item.name })}
                  onClick={() => onBump(p.id, -1)}
                >
                  −
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
