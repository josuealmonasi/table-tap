"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import CashMovementDialog from "@/components/dashboard/analytics/CashMovementDialog";

/**
 * The cash drawer's two entries, at the till where the drawer is: the money
 * the day starts with, and cash taken out of it. The cashier writes them down
 * here; the register close, which they do not open, sums them.
 */
export default function PosCashDrawer() {
  const t = useT();
  const [kind, setKind] = useState<"opening" | "withdrawal" | null>(null);
  return (
    <>
      <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => setKind("opening")}>
        {t("corte.opening")}
      </button>
      <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => setKind("withdrawal")}>
        {t("corte.addWithdrawal")}
      </button>
      <CashMovementDialog kind={kind} onClose={() => setKind(null)} onSaved={() => undefined} />
    </>
  );
}
