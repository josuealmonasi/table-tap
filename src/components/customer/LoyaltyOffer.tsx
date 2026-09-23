"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/context";
import { rememberCard, rememberDeclined, shouldOffer } from "@/lib/loyalty/device";
import type { CardFace } from "@/lib/loyalty/face";
import type { QrGrid } from "@/lib/loyalty/qr-grid";
import CardDownload from "@/components/loyalty/CardDownload";
import type { LoyaltyOfferInfo } from "@/lib/loyalty/offer";

interface LoyaltyOfferProps {
  offer: LoyaltyOfferInfo;
}

/**
 * "Junta visitas": offered once the diner has paid, and only to a phone that
 * has neither made a card here nor said "no volver a preguntar". Saying yes
 * makes the card and hands over the image; "ahora no" asks again next time,
 * and the box makes it the last time.
 */
export default function LoyaltyOffer({ offer }: LoyaltyOfferProps) {
  const t = useT();
  // Read after mount: the server has no localStorage, and deciding there would
  // flash the offer at a phone that already has a card.
  const [open, setOpen] = useState(false);
  const [dontAsk, setDontAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [card, setCard] = useState<{ face: CardFace; qr: QrGrid } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOpen(shouldOffer(offer.restaurantId));
  }, [offer.restaurantId]);

  async function create(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/loyalty/card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId: offer.restaurantId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? t("apiErr.generic"));
        return;
      }
      rememberCard(offer.restaurantId, data.code);
      setCard({ face: data.face, qr: data.qr });
    } catch {
      setError(t("offline.blocked"));
    } finally {
      setBusy(false);
    }
  }

  function notNow(): void {
    if (dontAsk) rememberDeclined(offer.restaurantId);
    setOpen(false);
  }

  if (card) {
    return (
      <section className="tt-card tt-loyalty-offer" aria-live="polite">
        <strong>{t("loyaltyOffer.ready")}</strong>
        <p className="tt-muted" style={{ margin: 0 }}>{t("loyaltyOffer.saveHint")}</p>
        <CardDownload face={card.face} qr={card.qr} />
        <Link className="tt-accent" href={`/rewards?c=${card.face.printedCode.replace(/-/g, "")}`}>
          {t("loyaltyOffer.checkLater")}
        </Link>
      </section>
    );
  }
  if (!open) return null;

  return (
    <section className="tt-card tt-loyalty-offer">
      <strong>{t("loyaltyOffer.title", { name: offer.restaurantName })}</strong>
      <p className="tt-muted" style={{ margin: 0 }}>
        {t("loyaltyOffer.body", { goal: offer.goal, reward: offer.reward })}
      </p>
      {error && <p className="tt-field-error" role="alert">{error}</p>}
      <button type="button" className="tt-btn tt-btn-primary" disabled={busy} onClick={() => void create()}>
        {busy ? t("loyaltyOffer.creating") : t("loyaltyOffer.create")}
      </button>
      <div className="tt-loyalty-offer-no">
        <label className="tt-check">
          <input type="checkbox" checked={dontAsk} onChange={e => setDontAsk(e.target.checked)} />
          <span>{t("loyaltyOffer.dontAsk")}</span>
        </label>
        <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={notNow}>
          {t("loyaltyOffer.notNow")}
        </button>
      </div>
    </section>
  );
}
