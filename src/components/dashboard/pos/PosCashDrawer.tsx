"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";
import CashMovementDialog from "@/components/dashboard/cash/CashMovementDialog";
import CloseShiftDialog from "@/components/dashboard/cash/CloseShiftDialog";

interface PosCashDrawerProps {
  /** Whether a shift is open at the drawer now. */
  shiftOpen: boolean;
  currency: string;
}

/**
 * The cash drawer's shift, at the till where the drawer is. With none open:
 * open one with the cash it starts with. With one open: write down cash taken
 * out, or close it with a blind count. The cashier never sees what the drawer
 * should hold until they have counted it — the register close, which they do
 * not open, is where that sum lives.
 */
export default function PosCashDrawer({ shiftOpen, currency }: PosCashDrawerProps) {
  const t = useT();
  const router = useRouter();
  const [dialog, setDialog] = useState<"opening" | "withdrawal" | "close" | null>(null);
  return (
    <>
      {shiftOpen ? (
        <>
          <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => setDialog("withdrawal")}>
            {t("corte.addWithdrawal")}
          </button>
          <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => setDialog("close")}>
            {t("shift.close")}
          </button>
        </>
      ) : (
        <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => setDialog("opening")}>
          {t("shift.open")}
        </button>
      )}
      <CashMovementDialog
        kind={dialog === "opening" || dialog === "withdrawal" ? dialog : null}
        onClose={() => setDialog(null)}
        onSaved={() => router.refresh()}
      />
      <CloseShiftDialog
        open={dialog === "close"}
        currency={currency}
        onClose={() => setDialog(null)}
        onClosed={() => router.refresh()}
      />
    </>
  );
}
