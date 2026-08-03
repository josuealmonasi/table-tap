"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { usePromotions, type PromotionInput } from "@/hooks/usePromotions";
import type { PromotionWithItems } from "@/lib/promotions";
import ComboForm from "./ComboForm";
import QuantityForm from "./QuantityForm";

/** Combo bundles and quantity deals for one restaurant. */
export default function PromotionsPanel({
  restaurantId,
  currency,
}: {
  restaurantId: string;
  currency: string;
}) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const { promotions, products, loading, create, setActive, remove } =
    usePromotions(restaurantId);
  const [saving, setSaving] = useState(false);

  async function add(input: PromotionInput) {
    setSaving(true);
    const err = await create(input);
    setSaving(false);
    toast(err ?? t("promos.created"), err ? "error" : "info");
  }

  async function del(p: PromotionWithItems) {
    const ok = await confirm({
      title: t("promos.deleteConfirm", { name: p.name }),
      message: t("promos.deleteMsg"),
      danger: true,
    });
    if (!ok) return;
    const err = await remove(p.id);
    if (err) toast(err, "error");
  }

  /** One line describing what the promotion does. */
  function describe(p: PromotionWithItems): string {
    const names = p.items
      .map(i => products.find(x => x.id === i.item_id))
      .filter(Boolean)
      .map((x, idx) => {
        const qty = p.items[idx]?.qty ?? 1;
        return qty > 1 ? `${qty}× ${x!.name}` : x!.name;
      })
      .join(" + ");
    if (p.kind === "combo") {
      return `${names} — ${formatMoney(Number(p.combo_price ?? 0), currency)}`;
    }
    if (p.kind === "bogo") {
      return t("promos.bogoDesc", { buy: p.buy_qty ?? 0, pay: p.pay_qty ?? 0, names });
    }
    const tiers = (p.tiers ?? [])
      .map(tier => `${tier.qty} → ${formatMoney(tier.price, currency)}`)
      .join(" · ");
    return `${names} — ${tiers}`;
  }

  return (
    <div className="tt-page">
      <h2 className="tt-serif" style={{ marginBottom: 2 }}>
        {t("promos.title")}
      </h2>
      <p className="tt-muted" style={{ marginTop: 0 }}>
        {t("promos.hint")}
      </p>

      <div className="tt-section" style={{ maxWidth: 620 }}>
        {loading ? (
          <p className="tt-muted">{t("common.loading")}</p>
        ) : promotions.length === 0 ? (
          <p className="tt-muted">{t("promos.empty")}</p>
        ) : (
          <div className="tt-coupon-list">
            {promotions.map(p => (
              <div key={p.id} className="tt-coupon-item">
                <div style={{ minWidth: 0 }}>
                  <strong>
                    {p.emoji} {p.name}
                  </strong>
                  {!p.active && <span className="tt-coupon-off">{t("promos.paused")}</span>}
                  <div className="tt-muted" style={{ fontSize: 13 }}>
                    {describe(p)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button
                    className="tt-btn tt-btn-ghost tt-btn-sm"
                    onClick={async () => {
                      const err = await setActive(p.id, !p.active);
                      if (err) toast(err, "error");
                    }}
                  >
                    {p.active ? t("promos.pause") : t("promos.resume")}
                  </button>
                  <button
                    className="tt-iconbtn"
                    title={t("promos.delete")}
                    onClick={() => del(p)}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="tt-section" style={{ maxWidth: 620, marginTop: 16 }}>
        <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 2 }}>
          {t("promos.newCombo")}
        </h3>
        <p className="tt-muted" style={{ marginTop: 0, fontSize: 13 }}>
          {t("promos.comboHint")}
        </p>
        <ComboForm
          products={products}
          currency={currency}
          saving={saving}
          onSubmit={add}
        />
      </div>

      <div className="tt-section" style={{ maxWidth: 620, marginTop: 16 }}>
        <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 2 }}>
          {t("promos.newDeal")}
        </h3>
        <p className="tt-muted" style={{ marginTop: 0, fontSize: 13 }}>
          {t("promos.dealHint")}
        </p>
        <QuantityForm
          products={products}
          currency={currency}
          saving={saving}
          onSubmit={add}
        />
      </div>
    </div>
  );
}
