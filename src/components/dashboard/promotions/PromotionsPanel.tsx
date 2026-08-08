"use client";

import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { usePromotions, type PromotionInput } from "@/hooks/usePromotions";
import Breadcrumb from "@/components/layout/Breadcrumb";
import type { PromotionWithItems } from "@/lib/promotions";
import ComboForm from "./ComboForm";
import QuantityForm from "./QuantityForm";
import { DeleteIcon, EditIcon, WarningIcon } from "@/components/ui/icons";
import { comboReachProblem } from "@/lib/combo-reach";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { Modal } from "@/components/ui/Modal";
import { useRowMemory } from "@/hooks/useRowMemory";

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
  const [editing, setEditing] = useState<PromotionWithItems | null>(null);
  const {
    promotions,
    products,
    categories,
    activeMenuIds,
    loading,
    create,
    update,
    setActive,
    remove,
  } = usePromotions(restaurantId);
  const rows = useRowMemory("promotions", 3, loading ? undefined : promotions.length);
  const itemsById = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const categoriesById = useMemo(
    () => new Map(categories.map(c => [c.id, c])),
    [categories],
  );

  const editingCombo = editing?.kind === "combo" ? editing : null;
  const editingDeal = editing && editing.kind !== "combo" ? editing : null;

  const [saving, setSaving] = useState(false);

  /** One path for both, so an edit can't drift from a create. */
  async function save(input: PromotionInput) {
    setSaving(true);
    const err = editing ? await update(editing.id, input) : await create(input);
    setSaving(false);
    if (!err) setEditing(null);
    toast(
      err ?? (editing ? t("promos.updated") : t("promos.created")),
      err ? "error" : "info",
    );
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
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[
              { labelKey: "nav.dashboard", href: "/dashboard" },
              { labelKey: "nav.promos" },
            ]}
          />
        </header>

        <p className="tt-muted" style={{ marginTop: 0, marginBottom: 16 }}>
          {t("promos.hint")}
        </p>

        <div className="tt-cols">
          <div className="tt-section tt-cols-full">
            {loading ? (
              <ListSkeleton rows={rows} />
            ) : promotions.length === 0 ? (
              <p className="tt-muted">{t("promos.empty")}</p>
            ) : (
              <div className="tt-coupon-list">
                {promotions.map(p => (
                  <div key={p.id} className="tt-coupon-item">
                    <div style={{ minWidth: 0 }}>
                      <strong>
                        <button
                          type="button"
                          className="tt-prod-name"
                          onClick={() => setEditing(p)}
                          title={t("promos.edit")}
                        >
                          {p.emoji} {p.name}
                        </button>
                      </strong>
                      {!p.active && (
                        <span className="tt-coupon-off">{t("promos.paused")}</span>
                      )}
                      <div className="tt-muted" style={{ fontSize: 13 }}>
                        {describe(p)}
                      </div>
                      {(() => {
                        const problem = comboReachProblem(
                          p,
                          itemsById,
                          categoriesById,
                          activeMenuIds,
                        );
                        if (!problem) return null;
                        return (
                          <div className="tt-promo-warn">
                            <WarningIcon size={14} weight="bold" />
                            <span>
                              {problem.itemName
                                ? t(
                                    problem.reason === "unavailable"
                                      ? "promos.hiddenUnavailable"
                                      : "promos.hiddenOffMenu",
                                    { item: problem.itemName },
                                  )
                                : t("promos.hiddenMissing")}
                            </span>
                          </div>
                        );
                      })()}
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
                        title={t("promos.edit")}
                        onClick={() => setEditing(p)}
                      >
                        <EditIcon size={16} />
                      </button>
                      <button
                        className="tt-iconbtn"
                        title={t("promos.delete")}
                        onClick={() => del(p)}
                      >
                        <DeleteIcon size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="tt-section">
            <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 2 }}>
              {t("promos.newCombo")}
            </h3>
            <p className="tt-muted" style={{ marginTop: 0, fontSize: 13 }}>
              {t("promos.comboHint")}
            </p>
            <ComboForm
              products={products}
              categories={categories}
              currency={currency}
              saving={saving}
              onSubmit={input => save(input)}
            />
          </div>

          <div className="tt-section">
            <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 2 }}>
              {t("promos.newDeal")}
            </h3>
            <p className="tt-muted" style={{ marginTop: 0, fontSize: 13 }}>
              {t("promos.dealHint")}
            </p>
            <QuantityForm
              products={products}
              categories={categories}
              currency={currency}
              saving={saving}
              onSubmit={input => save(input)}
            />
          </div>
        </div>
      </div>

      {/* Editing happens in a dialog, the same as products, sections and
          add-ons. Filling the create form further down the page meant the
          click appeared to do nothing until you scrolled, and the form's
          heading was the only clue you were no longer creating. */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        maxWidth={720}
        title={editing ? t("common.editingNamed", { name: editing.name }) : ""}
      >
        {editingCombo && (
          <ComboForm
            key={editingCombo.id}
            products={products}
            categories={categories}
            currency={currency}
            saving={saving}
            initial={editingCombo}
            onCancel={() => setEditing(null)}
            onSubmit={input => save(input)}
          />
        )}
        {editingDeal && (
          <QuantityForm
            key={editingDeal.id}
            products={products}
            categories={categories}
            currency={currency}
            saving={saving}
            initial={editingDeal}
            onCancel={() => setEditing(null)}
            onSubmit={input => save(input)}
          />
        )}
      </Modal>
    </div>
  );
}
