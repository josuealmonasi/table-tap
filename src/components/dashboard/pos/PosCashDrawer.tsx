"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import CashMovementDialog from "@/components/dashboard/cash/CashMovementDialog";
import CloseShiftDialog from "@/components/dashboard/cash/CloseShiftDialog";

interface PosCashDrawerProps {
  /** Whether a shift is open at the drawer now. */
  shiftOpen: boolean;
  currency: string;
  shiftCurrency?: string;
  shiftId?: string;
  /** Sales this device rang offline and has not sent yet. */
  heldSales?: number;
}

/**
 * The cash drawer's shift, at the till where the drawer is. With none open:
 * open one with the cash it starts with. With one open: write down cash taken
 * out, or close it with a blind count. The cashier never sees what the drawer
 * should hold until they have counted it — the register close, which they do
 * not open, is where that sum lives.
 */
export default function PosCashDrawer({ shiftOpen, currency, shiftCurrency = currency, shiftId, heldSales = 0 }: PosCashDrawerProps) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [dialog, setDialog] = useState<"opening" | "withdrawal" | "close" | null>(null);
  return (
    <>
      {shiftOpen && shiftCurrency !== currency && (
        <p className="tt-muted">{t("shift.currencyChanged", { currency: shiftCurrency, current: currency })}</p>
      )}
      {shiftOpen ? (
        <>
          <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => setDialog("withdrawal")}>
            {t("corte.addWithdrawal")}
          </button>
          {/* A shift closed with sales still on this device closes on a count
              the server cannot explain: their cash is in the drawer and not
              yet in its books. They are sent first. */}
          <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm"
            onClick={() => (heldSales > 0 ? toast(t("pos.offlineCloseBlocked", { n: heldSales }), "error") : setDialog("close"))}>
            {t("shift.close")}
          </button>
        </>
      ) : (
        <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => setDialog("opening")}>
          {t("shift.open")}
        </button>
      )}
      <CashMovementDialog
        shiftId={shiftId}
        kind={dialog === "opening" || dialog === "withdrawal" ? dialog : null}
        onClose={() => setDialog(null)}
        currency={dialog === "opening" ? currency : shiftCurrency}
        onSaved={() => router.refresh()}
      />
      <CloseShiftDialog
        shiftId={shiftId}
        open={dialog === "close"}
        currency={shiftCurrency}
        onClose={() => setDialog(null)}
        onClosed={() => router.refresh()}
      />
    </>
  );
}
