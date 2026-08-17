"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useCoupons, type Coupon } from "@/hooks/useCoupons";
import {
  COUPON_PATTERN_HINT,
  generateCouponCode,
  isValidCouponFormat,
  normalizeCoupon,
} from "@/lib/coupons";
import { DeleteIcon, EditIcon } from "@/components/ui/icons";
import { ListSkeleton } from "@/components/ui/Skeleton";
import { Modal } from "@/components/ui/Modal";
import { useRowMemory } from "@/hooks/useRowMemory";

/** Coupon codes an owner or manager hands out, with their usage so far. */
interface CouponFields {
  code: string;
  kind: "percent" | "fixed";
  value: string;
  maxUses: string;
  minSubtotal: string;
  startsAt: string;
  endsAt: string;
  staffOnly: boolean;
}

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

  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [minSubtotal, setMinSubtotal] = useState("");
  const [staffOnly, setStaffOnly] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [saving, setSaving] = useState(false);

  const normalized = normalizeCoupon(code);
  const codeOk = isValidCouponFormat(normalized);

  /**
   * A coupon as the form shows it. One place, because the fields are filled
   * from it when an edit opens and compared against it to decide whether
   * anything has actually been changed since.
   */
  function fieldsOf(c: Coupon): CouponFields {
    return {
      code: c.code,
      kind: c.kind,
      value: String(c.value),
      maxUses: c.max_uses === null ? "" : String(c.max_uses),
      minSubtotal: String(c.min_subtotal ?? 0),
      staffOnly: Boolean(c.staff_only),
      // The inputs are datetime-local, which only accepts YYYY-MM-DDTHH:mm —
      // a date-only value is rejected silently and the field comes up blank,
      // which would let a save quietly clear the coupon's schedule.
      startsAt: c.starts_at ? c.starts_at.slice(0, 16) : "",
      endsAt: c.ends_at ? c.ends_at.slice(0, 16) : "",
    };
  }

  // Nothing to save on an edit until a field differs from the stored coupon.
  // A new coupon has nothing to compare to, so its own required fields decide.
  const shown: CouponFields = {
    code,
    kind,
    value,
    maxUses,
    minSubtotal,
    startsAt,
    endsAt,
    staffOnly,
  };
  const dirty =
    !editing || JSON.stringify(fieldsOf(editing)) !== JSON.stringify(shown);

  /** Fills the form from a code and opens the dialog on it. */
  function startEdit(c: Coupon) {
    const f = fieldsOf(c);
    setEditing(c);
    setCode(f.code);
    setKind(f.kind);
    setValue(f.value);
    setMaxUses(f.maxUses);
    setMinSubtotal(f.minSubtotal);
    setStaffOnly(f.staffOnly);
    setStartsAt(f.startsAt);
    setEndsAt(f.endsAt);
    setAdding(true);
  }

  function closeForm() {
    setAdding(false);
    setEditing(null);
    setCode("");
    setValue("");
    setMaxUses("");
    setMinSubtotal("");
    setStartsAt("");
    setEndsAt("");
    setStaffOnly(false);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const input = {
      code: normalized,
      kind,
      value: Number(value) || 0,
      maxUses: maxUses.trim() === "" ? null : Number(maxUses),
      minSubtotal: Number(minSubtotal) || 0,
      staffOnly,
      startsAt: startsAt || null,
      endsAt: endsAt || null,
    };
    const err = editing ? await update(editing.id, input) : await create(input);
    setSaving(false);
    if (err) return toast(err, "error");
    toast(t(editing ? "coupons.updated" : "coupons.created"));
    closeForm();
  }

  async function del(c: Coupon) {
    const ok = await confirm({
      title: t("coupons.deleteConfirm", { code: c.code }),
      message: t("coupons.deleteMsg"),
      danger: true,
    });
    if (!ok) return;
    const err = await remove(c.id);
    toast(err ?? t("coupons.deleted"), err ? "error" : "info");
  }

  /** "50% off" / "MX$30 off", plus how many claims are left. */
  function describe(c: Coupon): string {
    const amount =
      c.kind === "percent"
        ? t("coupons.percentOff", { value: Number(c.value) })
        : t("coupons.amountOff", { value: formatMoney(Number(c.value), currency) });
    const uses =
      c.max_uses === null
        ? t("coupons.usedUnlimited", { used: c.uses_count })
        : t("coupons.usedOf", { used: c.uses_count, max: c.max_uses });

    const parts = [amount, uses];
    if (Number(c.min_subtotal) > 0) {
      parts.push(
        t("coupons.minSpend", { amount: formatMoney(Number(c.min_subtotal), currency) }),
      );
    }
    // A date-limited coupon needs its window visible; "why isn't my code
    // working" is almost always a schedule that hasn't started or has passed.
    const day = (iso: string) => new Date(iso).toLocaleDateString();
    if (c.starts_at && c.ends_at) {
      parts.push(t("coupons.between", { from: day(c.starts_at), to: day(c.ends_at) }));
    } else if (c.starts_at) {
      parts.push(t("coupons.from", { from: day(c.starts_at) }));
    } else if (c.ends_at) {
      parts.push(t("coupons.until", { to: day(c.ends_at) }));
    }
    return parts.join(" · ");
  }

  return (
    // Full row: this card carries a wide form (code, kind, value, claims,
    // min spend, two dates) plus the list, and it truncates in a half column.
    <div className="tt-section tt-cols-full">
      <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 2 }}>
        {t("coupons.title")}
      </h3>
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

      <Modal
        open={adding}
        onClose={closeForm}
        maxWidth={640}
        title={
          editing
            ? t("common.editingNamed", { name: editing.code })
            : t("coupons.newTitle")
        }
      >
        <form onSubmit={add} className="tt-coupon-form">
          <div className="tt-prodform-row">
            <input
              className="tt-input"
              style={{ flex: 1 }}
              placeholder={COUPON_PATTERN_HINT}
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="tt-btn tt-btn-ghost tt-btn-sm"
              onClick={() => setCode(generateCouponCode())}
            >
              {t("coupons.generate")}
            </button>
          </div>

          <div className="tt-prodform-row">
            <select
              className="tt-input"
              style={{ width: 130 }}
              value={kind}
              onChange={e => setKind(e.target.value as "percent" | "fixed")}
            >
              <option value="percent">{t("coupons.kindPercent")}</option>
              <option value="fixed">{t("coupons.kindFixed")}</option>
            </select>
            <input
              className="tt-input"
              style={{ width: 100 }}
              type="number"
              min="1"
              step={kind === "percent" ? "1" : "0.01"}
              placeholder={kind === "percent" ? "%" : currency}
              value={value}
              onChange={e => setValue(e.target.value)}
              required
            />
            <input
              className="tt-input"
              style={{ flex: 1, minWidth: 110 }}
              type="number"
              min="1"
              step="1"
              placeholder={t("coupons.maxUsesPlaceholder")}
              value={maxUses}
              onChange={e => setMaxUses(e.target.value)}
            />
          </div>

          <div className="tt-prodform-row">
            <input
              className="tt-input"
              style={{ width: 190 }}
              type="number"
              min="0"
              step="0.01"
              placeholder={t("coupons.minSubtotalPlaceholder")}
              value={minSubtotal}
              onChange={e => setMinSubtotal(e.target.value)}
              aria-label={t("coupons.minSubtotalPlaceholder")}
            />
            <label className="tt-muted" style={{ fontSize: 13 }}>
              {t("coupons.startsAt")}{" "}
              <input
                className="tt-input"
                style={{ width: 175 }}
                type="datetime-local"
                value={startsAt}
                onChange={e => setStartsAt(e.target.value)}
              />
            </label>
            <label className="tt-muted" style={{ fontSize: 13 }}>
              {t("coupons.endsAt")}{" "}
              <input
                className="tt-input"
                style={{ width: 175 }}
                type="datetime-local"
                value={endsAt}
                onChange={e => setEndsAt(e.target.value)}
              />
            </label>
          </div>

          <label
            className="tt-check-row"
            style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "flex-start" }}
          >
            <input
              type="checkbox"
              checked={staffOnly}
              onChange={e => setStaffOnly(e.target.checked)}
            />
            <span>
              <strong style={{ fontSize: 14 }}>{t("dash.staffOnly")}</strong>
              <span className="tt-muted tt-subline" style={{ display: "block", fontSize: 13 }}>
                {t("dash.staffOnlyHint")}
              </span>
            </span>
          </label>

          {code && !codeOk && (
            <p className="tt-field-error" style={{ margin: 0 }}>
              {t("coupons.badFormat", { format: COUPON_PATTERN_HINT })}
            </p>
          )}

          <div className="tt-prodform-actions">
            <button
              type="submit"
              className="tt-btn tt-btn-primary tt-btn-sm"
              disabled={!codeOk || !value || !dirty || saving}
            >
              {saving
                ? t("common.saving")
                : editing
                  ? t("promos.saveChanges")
                  : t("coupons.addAction")}
            </button>
            <button
              type="button"
              className="tt-btn tt-btn-ghost tt-btn-sm"
              onClick={closeForm}
            >
              {t("menu.cancel")}
            </button>
          </div>
        </form>
      </Modal>

      {loading ? (
        <ListSkeleton rows={rows} />
      ) : coupons.length === 0 ? (
        <p className="tt-muted">{t("coupons.empty")}</p>
      ) : (
        <div className="tt-coupon-list">
          {coupons.map(c => {
            const spent = c.max_uses !== null && c.uses_count >= c.max_uses;
            return (
              <div key={c.id} className="tt-coupon-item">
                <div style={{ minWidth: 0 }}>
                  <button
                    type="button"
                    className="tt-prod-name"
                    onClick={() => startEdit(c)}
                    title={t("coupons.edit")}
                  >
                    <code className="tt-coupon-code">{c.code}</code>
                  </button>
                  {!c.active && (
                    <span className="tt-coupon-off">{t("coupons.paused")}</span>
                  )}
                  {spent && <span className="tt-coupon-off">{t("coupons.spent")}</span>}
                  <div className="tt-muted" style={{ fontSize: 13 }}>
                    {describe(c)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button
                    className="tt-btn tt-btn-ghost tt-btn-sm"
                    onClick={async () => {
                      const next = !c.active;
                      const err = await setActive(c.id, next);
                      toast(
                        err ?? t(next ? "coupons.resumed_ok" : "coupons.paused_ok"),
                        err ? "error" : "info",
                      );
                    }}
                  >
                    {c.active ? t("coupons.pause") : t("coupons.resume")}
                  </button>
                  <button
                    className="tt-iconbtn"
                    title={t("coupons.edit")}
                    onClick={() => startEdit(c)}
                  >
                    <EditIcon size={16} />
                  </button>
                  <button
                    className="tt-iconbtn"
                    title={t("coupons.delete")}
                    onClick={() => del(c)}
                  >
                    <DeleteIcon size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
