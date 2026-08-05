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
  const { coupons, loading, create, setActive, remove } = useCoupons(restaurantId);

  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [minSubtotal, setMinSubtotal] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [saving, setSaving] = useState(false);

  const normalized = normalizeCoupon(code);
  const codeOk = isValidCouponFormat(normalized);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const err = await create({
      code: normalized,
      kind,
      value: Number(value) || 0,
      maxUses: maxUses.trim() === "" ? null : Number(maxUses),
      minSubtotal: Number(minSubtotal) || 0,
      startsAt: startsAt || null,
      endsAt: endsAt || null,
    });
    setSaving(false);
    if (err) return toast(err, "error");
    toast(t("coupons.created"));
    setCode("");
    setValue("");
    setMaxUses("");
    setMinSubtotal("");
    setStartsAt("");
    setEndsAt("");
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
    <div className="tt-section" style={{ maxWidth: 520, marginTop: 16 }}>
      <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 2 }}>
        {t("coupons.title")}
      </h3>
      <p className="tt-muted" style={{ marginTop: 0, fontSize: 13 }}>
        {t("coupons.hint")}
      </p>

      {loading ? (
        <p className="tt-muted">{t("common.loading")}</p>
      ) : coupons.length === 0 ? (
        <p className="tt-muted">{t("coupons.empty")}</p>
      ) : (
        <div className="tt-coupon-list">
          {coupons.map(c => {
            const spent = c.max_uses !== null && c.uses_count >= c.max_uses;
            return (
              <div key={c.id} className="tt-coupon-item">
                <div style={{ minWidth: 0 }}>
                  <code className="tt-coupon-code">{c.code}</code>
                  {!c.active && <span className="tt-coupon-off">{t("coupons.paused")}</span>}
                  {spent && <span className="tt-coupon-off">{t("coupons.spent")}</span>}
                  <div className="tt-muted" style={{ fontSize: 13 }}>
                    {describe(c)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button
                    className="tt-btn tt-btn-ghost tt-btn-sm"
                    onClick={async () => {
                      const err = await setActive(c.id, !c.active);
                      if (err) toast(err, "error");
                    }}
                  >
                    {c.active ? t("coupons.pause") : t("coupons.resume")}
                  </button>
                  <button className="tt-iconbtn" title={t("coupons.delete")} onClick={() => del(c)}>
                    🗑️
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

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
            style={{ width: 150 }}
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

        {code && !codeOk && (
          <p style={{ color: "#c0392b", fontSize: 13, margin: 0 }}>
            {t("coupons.badFormat", { format: COUPON_PATTERN_HINT })}
          </p>
        )}

        <button
          type="submit"
          className="tt-btn tt-btn-primary tt-btn-sm"
          disabled={!codeOk || !value || saving}
        >
          {saving ? t("common.saving") : t("coupons.add")}
        </button>
      </form>
    </div>
  );
}
