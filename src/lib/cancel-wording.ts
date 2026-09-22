// ============================================================================
// How the cancel dialog words what the server said it will do.
//
// The dialog does not guess from `pay_method` any more. It asks the route for
// the plan — money back through Stripe, notes out of a drawer, a void on the
// restaurant's own terminal, or a share of a table's bill — and says each of
// those in its own sentence, because a person has to do all but the first.
// ============================================================================
import type { CancelSummary } from "@/lib/cancel-plan";

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export interface CancelWording {
  message: string;
  confirmKey: string;
  done: string;
}

export function cancelWording(s: CancelSummary, money: (n: number) => string, t: Translate): CancelWording {
  if (!s.paid) {
    return { message: t("orders.unpaidCancelMsg"), confirmKey: "orders.cancelOrder", done: t("orders.cancelledToast") };
  }

  const sentences: string[] = [];
  if (s.refund > 0) sentences.push(t("orders.refundMsg", { amount: money(s.refund) }));
  if (s.cash > 0) sentences.push(t("orders.cashCancelMsg", { amount: money(s.cash) }));
  if (s.terminal > 0) sentences.push(t("orders.terminalCancelMsg", { amount: money(s.terminal) }));
  if (s.withTable > 0) sentences.push(t("orders.withTableCancelMsg", { amount: money(s.withTable) }));

  const byHand = s.cash + s.terminal + s.withTable;
  const onlyCash = s.cash > 0 && s.cash === byHand && s.refund === 0;
  return {
    message: sentences.join(" "),
    confirmKey: byHand === 0 ? "orders.cancelRefund" : onlyCash ? "orders.cancelCashOrder" : "orders.cancelHandBack",
    done:
      byHand === 0
        ? t("orders.cancelledRefunded")
        : onlyCash
          ? t("orders.cancelledCash")
          : t("orders.cancelledHandBack", { amount: money(byHand) }),
  };
}
