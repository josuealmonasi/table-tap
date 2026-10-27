"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useCoupons, type Coupon } from "@/hooks/useCoupons";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { useRowMemory } from "@/hooks/useRowMemory";
import CouponForm from "./CouponForm";
import CouponRow from "./CouponRow";
import { couponStatus, type CouponFilter } from "./coupon-filter";

/** Coupon codes an owner or manager hands out, with their usage so far. */
export default function CouponsPanel({
  restaurantId,
  currency,
  timeZone = "America/Mexico_City",
}: {
  restaurantId: string;
  currency: string;
  timeZone?: string;
}) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const { coupons, loading, loadFailed, reload, create, update, setActive, remove } =
    useCoupons(restaurantId);
  const rows = useRowMemory("coupons", 3, loading ? undefined : coupons.length);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<CouponFilter>("all");
  const [clockTick, setClockTick] = useState(0);
  const now = Date.now();
  useEffect(() => {
    const current = Date.now();
    const next = Math.min(...coupons.flatMap(c => [c.starts_at, c.ends_at])
      .filter((date): date is string => Boolean(date)).map(date => new Date(date).getTime()).filter(date => date > current));
    if (!Number.isFinite(next)) return;
    const timer = setTimeout(() => setClockTick(n => n + 1), Math.min(next - current, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [coupons, clockTick]);
  const visible = coupons.filter(c => c.code.toLowerCase().includes(search.trim().toLowerCase())
    && (filter === "all" || couponStatus(c, now) === filter));

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
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        <input type="search" className="tt-input" style={{ flex: "1 1 180px", minWidth: 0 }}
          aria-label={t("couponSearch.search")} placeholder={t("couponSearch.search")}
          value={search} onChange={e => setSearch(e.target.value)} />
        <select className="tt-input" aria-label={t("couponSearch.status")} value={filter}
          onChange={e => setFilter(e.target.value as CouponFilter)}>
          {(["all", "active", "expired", "paused"] as const).map(value => <option key={value} value={value}>{t(`couponSearch.${value}`)}</option>)}
        </select>
      </div>
      {filter === "expired" && <p className="tt-muted">{t("couponSearch.expiredHint")}</p>}

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
          currency={currency} timeZone={timeZone}
          onClose={closeForm}
          onSave={input => (editing ? update(editing.id, input) : create(input))}
        />
      )}

      {loadFailed && <p className="tt-field-error" role="alert">
        {t("coupons.loadFailed")} <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={reload}>{t("fallback.retry")}</button>
      </p>}
      {loading ? (
        <ListSkeleton rows={rows} />
      ) : coupons.length === 0 && !loadFailed ? (
        <p className="tt-muted">{t("coupons.empty")}</p>
      ) : (
        <div className="tt-coupon-list">
          {!loadFailed && visible.length === 0 && <p className="tt-muted">{t("couponSearch.empty")}</p>}
          {visible.map(c => (
            <CouponRow
              key={c.id}
              coupon={c}
              currency={currency} timeZone={timeZone}
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
