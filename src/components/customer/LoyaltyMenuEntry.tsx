"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { LoyaltyIcon } from "@/components/ui/icons";
import { useT } from "@/lib/i18n/context";
import { readDeviceCard } from "@/lib/loyalty/device";
import type { LoyaltyOfferInfo } from "@/lib/loyalty/offer";
import { ladderLines } from "@/lib/loyalty/ladder";
import LoyaltyOffer from "./LoyaltyOffer";

interface LoyaltyMenuEntryProps {
  offer: LoyaltyOfferInfo;
}

/**
 * The visit card, from the menu, whenever the diner wants it.
 *
 * It used to be offered only once the bill was paid, so a diner who wanted it
 * before ordering — or who said "ahora no" and changed their mind — had no way
 * to it. A phone that already made one here goes to its card instead. Always
 * rendered at the same height, and only the words change once this phone is
 * read, so the menu below it never jumps.
 *
 * A chip beside the table's badge, not a row of its own: a full-width band
 * between the service buttons and the order banners pushed the menu down for
 * something a diner taps once. The rewards are in the sheet it opens, and in
 * its accessible name, so a screen reader still hears what the card gives.
 */
export default function LoyaltyMenuEntry({ offer }: LoyaltyMenuEntryProps) {
  const t = useT();
  const router = useRouter();
  const [mine, setMine] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const device = readDeviceCard(offer.restaurantId);
    setMine(device && "code" in device ? device.code : null);
  }, [offer.restaurantId]);

  return (
    <>
      <button
        type="button"
        className="tt-loyalty-chip"
        aria-label={`${t(mine ? "loyaltyMenu.mine" : "loyaltyMenu.entry")} · ${ladderLines(offer.steps, t).join(" · ")}`}
        onClick={() => (mine ? router.push(`/rewards?c=${mine}`) : setOpen(true))}
      >
        <LoyaltyIcon size={14} weight="bold" />
        <span className="tt-loyalty-chip-text">{t(mine ? "loyaltyMenu.mine" : "loyaltyMenu.entry")}</span>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} maxWidth={420} variant="sheet" label={t("loyalty.title")}>
        <LoyaltyOffer offer={offer} asked />
      </Modal>
    </>
  );
}
