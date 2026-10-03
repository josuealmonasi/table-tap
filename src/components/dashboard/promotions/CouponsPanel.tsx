"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useCoupons, type Coupon } from "@/hooks/useCoupons";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useRowMemory } from "@/hooks/useRowMemory";
import CouponForm from "./CouponForm";
import CouponRow from "./CouponRow";

/** Coupon codes an owner or manager hands out, with their usage so far. */
export default function CouponsPanel({
  restaurantId,
  currency,
}: {
  restaurantId: string;
  currency: string;
}) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const { coupons, loading, create, update, setActive, remove } =
    useCoupons(restaurantId);
  const rows = useRowMemory("coupons", 3, loading ? undefined : coupons.length);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);

  function startEdit(c: Coupon): void {
    setEditing(c);
    setAdding(true);
  }

  function closeForm(): void {
    setAdding(false);
    setEditing(null);
  }

  async function toggle(c: Coupon): Promise<void> {
    const next = !c.active;
    const err = await setActive(c.id, next);
    toast(
      err ?? t(next ? "coupons.resumed_ok" : "coupons.paused_ok"),
      err ? "error" : "info",
    );
  }

  async function del(c: Coupon): Promise<void> {
    const ok = await confirm({
      title: t("coupons.deleteConfirm", { code: c.code }),
      message: t("coupons.deleteMsg"),
      danger: true,
    });
    if (!ok) return;
    const err = await remove(c.id);
    toast(err ?? t("coupons.deleted"), err ? "error" : "info");
  }

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("coupons.title")}
        </h3>
      </div>
      <p className="tt-muted" style={{ marginTop: 0, fontSize: 13 }}>
        {t("coupons.hint")}
      </p>

      {/* Creating happens in a dialog, the same as products and promotions —
          an always-open form put an empty create step above the codes that
          already exist. */}
      <div className="tt-promo-add">
        <button
          className="tt-btn tt-btn-primary tt-btn-sm"
          onClick={() => setAdding(true)}
        >
          {t("coupons.add")}
        </button>
      </div>

      {adding && (
        <CouponForm
          editing={editing}
          currency={currency}
          onClose={closeForm}
          onSave={input => (editing ? update(editing.id, input) : create(input))}
        />
      )}

      {loading ? (
        <ListSkeleton rows={rows} />
      ) : coupons.length === 0 ? (
        <p className="tt-muted">{t("coupons.empty")}</p>
      ) : (
        <div className="tt-coupon-list">
          {coupons.map(c => (
            <CouponRow
              key={c.id}
              coupon={c}
              currency={currency}
              onEdit={startEdit}
              onToggle={c2 => void toggle(c2)}
              onDelete={c2 => void del(c2)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
