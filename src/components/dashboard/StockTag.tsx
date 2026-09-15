"use client";

import { useT } from "@/lib/i18n/context";

/**
 * How many of this dish are left, on the tile that sells it.
 *
 * Only for the dishes that count: most do not track stock at all, and a tag on
 * those would be a number nobody can act on. Without it the first anyone knew
 * of a limit was a refusal after they had already built the order — "ya no
 * queda" with no way to see how far they could have gone.
 *
 * It is a reading, not a promise. Between seeing it and pressing the tile
 * somebody else can take the last one, and the reservation in the database is
 * what decides that — see `reserve_stock`. The count is kept close by
 * `useLiveStock`; what makes it safe is that nothing trusts it.
 */
export default function StockTag({ left }: { left: number | null | undefined }) {
  const t = useT();
  if (left === null || left === undefined) return null;
  return (
    <span className={`tt-stock-tag ${left <= 3 ? "tt-stock-tag-low" : ""}`}>
      {t("pos.leftCount", { n: left })}
    </span>
  );
}
