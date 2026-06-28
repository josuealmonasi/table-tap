"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import type { MenuItem } from "@/lib/types";
import type { ProductInput } from "@/hooks/useMenuEditor";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import ProductForm from "./ProductForm";

/** One product in a section: image/emoji, price, availability switch, add-ons, edit/delete. */
export default function ProductRow({
  product,
  addons,
  linkedAddonIds,
  currency,
  onUpdate,
  onDelete,
  onToggleAvailable,
}: {
  product: MenuItem;
  addons: MenuItem[];
  linkedAddonIds: string[];
  currency: string;
  onUpdate: (id: string, input: ProductInput, addonIds: string[]) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggleAvailable: (id: string, available: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const confirm = useConfirm();
  const linkedNames = linkedAddonIds
    .map((id) => addons.find((a) => a.id === id))
    .filter(Boolean) as MenuItem[];

  if (editing) {
    return (
      <div className="tt-prod tt-prod-editing">
        <ProductForm
          initial={product}
          addons={addons}
          selectedAddonIds={linkedAddonIds}
          currency={currency}
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (input, addonIds) => {
            await onUpdate(product.id, input, addonIds);
            setEditing(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className={`tt-prod ${product.available ? "" : "tt-prod-off"}`}>
      <div className="tt-prod-thumb">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image_url} alt={product.name} />
        ) : (
          <span>{product.emoji || "🍽️"}</span>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <strong>{product.name}</strong>
          {product.popular && <span className="tt-pop">Popular</span>}
          {!product.available && <span className="tt-badge">Unavailable</span>}
        </div>
        {product.description && (
          <div className="tt-desc tt-muted" style={{ margin: "2px 0" }}>{product.description}</div>
        )}
        {linkedNames.length > 0 && (
          <div className="tt-muted" style={{ fontSize: 12 }}>
            + {linkedNames.map((a) => a.name).join(", ")}
          </div>
        )}
      </div>

      <div className="tt-prod-right">
        <strong className="tt-accent">{formatMoney(product.price, currency)}</strong>
        <label className="tt-switch" title={product.available ? "Available" : "Unavailable"}>
          <input
            type="checkbox"
            checked={product.available}
            onChange={(e) => onToggleAvailable(product.id, e.target.checked)}
          />
          <span className="tt-switch-track" />
        </label>
        <div className="tt-prod-actions">
          <button className="tt-iconbtn" onClick={() => setEditing(true)} title="Edit">✏️</button>
          <button
            className="tt-iconbtn"
            onClick={async () => {
              if (
                await confirm({
                  title: `Delete “${product.name}”?`,
                  message: "This can't be undone.",
                  confirmLabel: "Delete",
                  danger: true,
                })
              ) {
                onDelete(product.id);
              }
            }}
            title="Delete"
          >
            🗑️
          </button>
        </div>
      </div>
    </div>
  );
}
