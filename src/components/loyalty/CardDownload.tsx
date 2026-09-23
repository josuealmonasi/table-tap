"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { drawCard } from "@/lib/loyalty/card-image";
import type { CardFace } from "@/lib/loyalty/face";
import type { QrGrid } from "@/lib/loyalty/qr-grid";

interface CardDownloadProps {
  face: CardFace;
  qr: QrGrid;
}

/**
 * The card as an image: drawn here, shown, and handed over to save.
 *
 * Shown as well as downloaded, because a download is not the same thing on
 * every phone — on an iPhone it opens the picture, and pressing on it is how it
 * reaches Photos — so the picture is on the page to press on either way.
 */
export default function CardDownload({ face, qr }: CardDownloadProps) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let made: string | null = null;
    let live = true;
    const host = typeof window === "undefined" ? "" : window.location.host;
    drawCard(face, qr, {
      title: t("loyaltyOffer.cardTitle"),
      rewardLine: face.reward
        ? t("loyaltyOffer.cardReward", { goal: face.standing.goal, reward: face.reward })
        : t("loyaltyOffer.cardGoal", { goal: face.standing.goal }),
      showIt: t("loyaltyOffer.cardShow"),
      checkAt: t("loyaltyOffer.cardCheck", { site: `${host}/rewards` }),
    })
      .then(blob => {
        if (!live) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [face, qr, t]);

  const fileName = `${t("loyaltyOffer.fileName")}-${face.restaurantName}`.toLowerCase().replace(/[^a-z0-9áéíóúñü]+/gi, "-");

  return (
    <div className="tt-card-download">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- a blob drawn on this page
        <img className="tt-card-image" src={url} alt={t("loyaltyOffer.cardAlt", { code: face.printedCode })} />
      ) : (
        <div className="tt-card-image tt-card-image-empty" aria-hidden="true" />
      )}
      <p className="tt-card-code">{face.printedCode}</p>
      {failed ? (
        <p className="tt-field-error" role="alert">{t("loyaltyOffer.drawFailed", { code: face.printedCode })}</p>
      ) : (
        <a
          className={`tt-btn tt-btn-primary${url ? "" : " tt-btn-disabled"}`}
          href={url ?? undefined}
          download={`${fileName}.png`}
          aria-disabled={!url}
        >
          {t("loyaltyOffer.download")}
        </a>
      )}
      <p className="tt-muted" style={{ fontSize: 12, margin: 0 }}>{t("loyaltyOffer.iosHint")}</p>
    </div>
  );
}
