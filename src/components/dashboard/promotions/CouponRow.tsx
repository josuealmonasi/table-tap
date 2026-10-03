"use client";

import { formatMoney, dateLocale } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/context";
import type { Coupon } from "@/hooks/useCoupons";
import { DeleteIcon, EditIcon } from "@/components/ui/icons";

interface CouponRowProps {
  coupon: Coupon;
  currency: string;
  onEdit: (c: Coupon) => void;
  onToggle: (c: Coupon) => void;
  onDelete: (c: Coupon) => void;
}

/** One code: what it takes off, how often it has been used, and when it works. */
export default function CouponRow({
  coupon: c,
  currency,
  onEdit,
  onToggle,
  onDelete,
}: CouponRowProps) {
  const t = useT();
  const { locale } = useLocale();
  const spent = c.max_uses !== null && c.uses_count >= c.max_uses;

  /** "50% off" / "MX$30 off", plus how many claims are left. */
  function describe(): string {
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
    // In the app's language, not the browser's: a Spanish owner on an English
    // phone read "9/30/2026" beside Spanish words.
    const day = (iso: string) => new Date(iso).toLocaleDateString(dateLocale(locale));
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
    <div className="tt-coupon-item">
      <div style={{ minWidth: 0 }}>
        <button
          type="button"
          className="tt-prod-name"
          onClick={() => onEdit(c)}
          title={t("coupons.edit")}
        >
          <code className="tt-coupon-code">{c.code}</code>
        </button>
        {!c.active && <span className="tt-coupon-off">{t("coupons.paused")}</span>}
        {spent && <span className="tt-coupon-off">{t("coupons.spent")}</span>}
        <div className="tt-muted" style={{ fontSize: 13 }}>
          {describe()}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => onToggle(c)}>
          {c.active ? t("coupons.pause") : t("coupons.resume")}
        </button>
        <button
          className="tt-iconbtn"
          title={t("coupons.edit")}
          onClick={() => onEdit(c)}
        >
          <EditIcon size={16} />
        </button>
        <button
          className="tt-iconbtn"
          title={t("coupons.delete")}
          onClick={() => onDelete(c)}
        >
          <DeleteIcon size={16} />
        </button>
      </div>
    </div>
  );
}
