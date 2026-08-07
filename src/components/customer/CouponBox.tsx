"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { COUPON_PATTERN_HINT, normalizeCoupon } from "@/lib/coupons";
import type { AppliedCoupon } from "@/lib/pricing";

/**
 * "Got a coupon?" link that opens a small dialog to enter a code. Checking the
 * code is a server round-trip — nothing about which codes exist ever reaches
 * the browser, and the discount is recomputed again at checkout regardless of
 * what we show here.
 */
export default function CouponBox({
  restaurantId,
  subtotal,
  applied,
  onApply,
  onRemove,
}: {
  restaurantId: string;
  subtotal: number;
  applied: AppliedCoupon | null;
  onApply: (coupon: AppliedCoupon) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/coupons/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId, code: normalizeCoupon(code), subtotal }),
      });
      const data = await res.json();
      if (data.valid) {
        onApply({
          code: data.code,
          kind: data.kind,
          value: data.value,
          minSubtotal: data.minSubtotal,
        });
        setOpen(false);
        setCode("");
        return;
      }
      setError(t(`coupon.${data.reason ?? "notFound"}`));
    } catch {
      setError(t("notice.network"));
    } finally {
      setChecking(false);
    }
  }

  if (applied) {
    return (
      <div className="tt-coupon-applied">
        <span>
          🎟️ <strong>{applied.code}</strong> {t("coupon.applied")}
        </span>
        <button type="button" className="tt-linkbtn" onClick={onRemove}>
          {t("coupon.remove")}
        </button>
      </div>
    );
  }

  return (
    <>
      <button type="button" className="tt-linkbtn" onClick={() => setOpen(true)}>
        {t("coupon.gotOne")}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        maxWidth={360}
        label={t("coupon.title")}
      >
        <form onSubmit={submit}>
          <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 4 }}>
            {t("coupon.title")}
          </h3>
          <p className="tt-muted" style={{ marginTop: 0, fontSize: 13 }}>
            {t("coupon.hint", { format: COUPON_PATTERN_HINT })}
          </p>
          <input
            className="tt-input"
            value={code}
            onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder={COUPON_PATTERN_HINT}
            autoFocus
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
          {error && <p className="tt-field-error">{error}</p>}
          <div
            style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}
          >
            <button
              type="button"
              className="tt-btn tt-btn-ghost tt-btn-sm"
              onClick={() => setOpen(false)}
            >
              {t("tip.cancel")}
            </button>
            <button
              type="submit"
              className="tt-btn tt-btn-primary tt-btn-sm"
              disabled={!code.trim() || checking}
            >
              {checking ? t("coupon.checking") : t("coupon.apply")}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
