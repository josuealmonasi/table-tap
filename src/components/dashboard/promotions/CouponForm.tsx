"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import type { Coupon, CouponInput } from "@/hooks/useCoupons";
import {
  COUPON_PATTERN_HINT,
  generateCouponCode,
  isValidCouponFormat,
  normalizeCoupon,
} from "@/lib/coupons";
import { Modal } from "@/components/ui/Modal";

/** A coupon as the form shows it. */
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

const EMPTY: CouponFields = {
  code: "",
  kind: "percent",
  value: "",
  maxUses: "",
  minSubtotal: "",
  startsAt: "",
  endsAt: "",
  staffOnly: false,
};

/**
 * One place, because the fields are filled from it when an edit opens and
 * compared against it to decide whether anything has actually been changed
 * since.
 */
function fieldsOf(c: Coupon): CouponFields {
  return {
    code: c.code,
    kind: c.kind,
    value: String(c.value),
    maxUses: c.max_uses === null ? "" : String(c.max_uses),
    minSubtotal: String(c.min_subtotal ?? 0),
    staffOnly: Boolean(c.staff_only),
    // The inputs are datetime-local, which only accepts YYYY-MM-DDTHH:mm — a
    // date-only value is rejected silently and the field comes up blank, which
    // would let a save quietly clear the coupon's schedule.
    startsAt: c.starts_at ? c.starts_at.slice(0, 16) : "",
    endsAt: c.ends_at ? c.ends_at.slice(0, 16) : "",
  };
}

interface CouponFormProps {
  /** The code being edited, or null for a new one. */
  editing: Coupon | null;
  currency: string;
  onClose: () => void;
  /** Saves it; answers the refusal, or null when it saved. */
  onSave: (input: CouponInput) => Promise<string | null>;
}

/**
 * Creating or editing a code, in a dialog — the same as products and
 * promotions. Mounted only while it is open, so every opening starts from the
 * coupon or from nothing.
 */
export default function CouponForm({
  editing,
  currency,
  onClose,
  onSave,
}: CouponFormProps) {
  const t = useT();
  const toast = useToast();
  const [f, setF] = useState<CouponFields>(editing ? fieldsOf(editing) : EMPTY);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof CouponFields>(key: K, value: CouponFields[K]) =>
    setF(prev => ({ ...prev, [key]: value }));

  const normalized = normalizeCoupon(f.code);
  const codeOk = isValidCouponFormat(normalized);
  // Nothing to save on an edit until a field differs from the stored coupon.
  // A new coupon has nothing to compare to, so its own required fields decide.
  const dirty = !editing || JSON.stringify(fieldsOf(editing)) !== JSON.stringify(f);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSaving(true);
    const err = await onSave({
      code: normalized,
      kind: f.kind,
      value: Number(f.value) || 0,
      maxUses: f.maxUses.trim() === "" ? null : Number(f.maxUses),
      minSubtotal: Number(f.minSubtotal) || 0,
      staffOnly: f.staffOnly,
      startsAt: f.startsAt || null,
      endsAt: f.endsAt || null,
    });
    setSaving(false);
    if (err) return toast(err, "error");
    toast(t(editing ? "coupons.updated" : "coupons.created"));
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      maxWidth={640}
      title={
        editing ? t("common.editingNamed", { name: editing.code }) : t("coupons.newTitle")
      }
    >
      <form onSubmit={submit} className="tt-coupon-form">
        <div className="tt-prodform-row">
          <input
            className="tt-input"
            style={{ flex: 1 }}
            placeholder={COUPON_PATTERN_HINT}
            value={f.code}
            onChange={e => set("code", e.target.value.toUpperCase())}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            className="tt-btn tt-btn-ghost tt-btn-sm"
            onClick={() => set("code", generateCouponCode())}
          >
            {t("coupons.generate")}
          </button>
        </div>

        <div className="tt-prodform-row">
          <select
            className="tt-input"
            style={{ width: 130 }}
            value={f.kind}
            onChange={e => set("kind", e.target.value as "percent" | "fixed")}
          >
            <option value="percent">{t("coupons.kindPercent")}</option>
            <option value="fixed">{t("coupons.kindFixed")}</option>
          </select>
          <input
            className="tt-input"
            style={{ width: 100 }}
            type="number"
            min="1"
            step={f.kind === "percent" ? "1" : "0.01"}
            placeholder={f.kind === "percent" ? "%" : currency}
            value={f.value}
            onChange={e => set("value", e.target.value)}
            required
          />
          <input
            className="tt-input"
            style={{ flex: 1, minWidth: 110 }}
            type="number"
            min="1"
            step="1"
            placeholder={t("coupons.maxUsesPlaceholder")}
            value={f.maxUses}
            onChange={e => set("maxUses", e.target.value)}
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
            value={f.minSubtotal}
            onChange={e => set("minSubtotal", e.target.value)}
            aria-label={t("coupons.minSubtotalPlaceholder")}
          />
          <label className="tt-muted" style={{ fontSize: 13 }}>
            {t("coupons.startsAt")}{" "}
            <input
              className="tt-input"
              style={{ width: 175 }}
              type="datetime-local"
              value={f.startsAt}
              onChange={e => set("startsAt", e.target.value)}
            />
          </label>
          <label className="tt-muted" style={{ fontSize: 13 }}>
            {t("coupons.endsAt")}{" "}
            <input
              className="tt-input"
              style={{ width: 175 }}
              type="datetime-local"
              value={f.endsAt}
              onChange={e => set("endsAt", e.target.value)}
            />
          </label>
        </div>

        <label
          className="tt-check-row"
          style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "flex-start" }}
        >
          <input
            type="checkbox"
            checked={f.staffOnly}
            onChange={e => set("staffOnly", e.target.checked)}
          />
          <span>
            <strong style={{ fontSize: 14 }}>{t("dash.staffOnly")}</strong>
            <span
              className="tt-muted tt-subline"
              style={{ display: "block", fontSize: 13 }}
            >
              {t("dash.staffOnlyHint")}
            </span>
          </span>
        </label>

        {f.code && !codeOk && (
          <p className="tt-field-error" style={{ margin: 0 }}>
            {t("coupons.badFormat", { format: COUPON_PATTERN_HINT })}
          </p>
        )}

        <div className="tt-prodform-actions">
          <button
            type="submit"
            className="tt-btn tt-btn-primary tt-btn-sm"
            disabled={!codeOk || !f.value || !dirty || saving}
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
            onClick={onClose}
          >
            {t("menu.cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
