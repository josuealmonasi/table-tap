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
        className="tt-loyalty-entry"
        onClick={() => (mine ? router.push(`/rewards?c=${mine}`) : setOpen(true))}
      >
        <LoyaltyIcon size={16} weight="bold" />
        <span className="tt-loyalty-entry-text">
          <strong>{t(mine ? "loyaltyMenu.mine" : "loyaltyMenu.entry")}</strong>
          {/* Every reward, in order — the first is the nearest, so it is the
              one a one-line row always shows in full. */}
          <span className="tt-muted"> · {ladderLines(offer.steps, t).join(" · ")}</span>
        </span>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} maxWidth={420} variant="sheet" label={t("loyalty.title")}>
        <LoyaltyOffer offer={offer} asked />
      </Modal>
    </>
  );
}
