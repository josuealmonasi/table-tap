"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { shortMessage } from "@/lib/stock-message";
import { formatMoney } from "@/lib/format";
import { printableReceipt } from "@/lib/print-document";
import { printWhenReady } from "@/lib/print-window";
import type { Restaurant } from "@/lib/types";
import type { AccountListItem } from "@/hooks/useOpenAccounts";
import type { usePosCart } from "@/hooks/usePosCart";
import type { usePosSaleDetails } from "@/hooks/usePosSaleDetails";
import type { PosTicket } from "@/components/dashboard/pos/PosTicketModal";

interface PosChargeInput {
  restaurant: Restaurant;
  cart: ReturnType<typeof usePosCart>;
  details: ReturnType<typeof usePosSaleDetails>;
  /** False when no mail provider is configured — then emailing is not offered. */
  canEmailReceipt: boolean;
}

/**
 * Ringing a sale at the till: the request, the answer, and the ticket.
 *
 * Nothing reaches the server until the money is in the drawer, and then it is
 * one request that creates the order already paid and already on the pass.
 */
export function usePosCharge({ restaurant, cart, details, canEmailReceipt }: PosChargeInput) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const { lines } = cart;
  const { tipPct, tipCustom } = details;
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState<PosTicket | null>(null);
  /** How the customer is paying, asked about before the sale is sent. */
  const [pending, setPending] = useState<"cash" | "card" | null>(null);

  const money = (n: number) => formatMoney(n, restaurant.currency);

  /**
   * Prints the ticket when nobody asked for it by email.
   *
   * Through the browser's own print dialog, which means any printer the
   * counter machine can already see — USB, Ethernet, AirPrint — works with
   * nothing to integrate. Chrome started with `--kiosk-printing` puts it on
   * the roll with no dialog at all, which is what a counter actually wants.
   *
   * The receipt itself is the server's, unchanged: the same document that goes
   * in the email. `printableReceipt` only describes the paper — an 80mm page
   * with the screen's greys pushed to black — so a printed ticket cannot drift
   * away from an emailed one.
   */
  function printReceipt(html: string): void {
    const w = window.open("", "_blank", "width=380,height=640");
    if (!w) {
      // A blocked pop-up must not look like a printed ticket.
      toast(t("pos.printBlocked"), "error");
      return;
    }
    w.document.write(printableReceipt(html, restaurant.name));
    w.document.close();
    w.focus();
    printWhenReady(w);
  }

  /** Ring it up. The money is already in the drawer by the time this runs. */
  async function charge(
    method: "cash" | "card" | "account",
    account?: AccountListItem,
  ): Promise<void> {
    if (lines.length === 0 || busy) return;
    setPending(null);
    setBusy(true);
    try {
      const res = await fetch("/api/pos/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // One reference per sale, so a request sent twice cannot charge
          // twice or put two tickets on the pass.
          posRef: crypto.randomUUID(),
          items: lines,
          method,
          accountId: account?.id,
          customerName: details.customerName.trim() || undefined,
          note: details.note.trim() || undefined,
          // On an account the tip waits for the day it is paid.
          tipPct: account ? undefined : tipCustom === null ? tipPct : undefined,
          tipAmount: account ? undefined : (tipCustom ?? undefined),
          email:
            canEmailReceipt && !details.noTicket
              ? details.email.trim() || undefined
              : undefined,
          noReceipt: details.noTicket || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === "outOfStock") {
          // With the numbers in it. The refusal has always known how many are
          // left and every screen dropped them, so the answer to "how many can
          // I have then?" was a trip to the kitchen.
          toast(shortMessage(data.short ?? [], t), "error");
        } else {
          toast(data.error ?? t("done.networkError"), "error");
        }
        return;
      }
      if (data.onAccount) {
        toast(
          t("accounts.charged", {
            name: data.onAccount.name,
            amount: money(Number(data.total)),
          }),
        );
      }
      if (data.receipt === "failed") toast(t("pos.receiptFailed"), "error");
      else if (data.receipt === "sent") toast(t("pos.receiptSent"));
      // No address, or an address the mail never reached: it prints.
      if (data.receiptHtml) printReceipt(data.receiptHtml);
      setTicket({
        code: data.code,
        total: data.total,
        handedOver: Boolean(data.handedOver),
      });
      cart.clear();
      details.reset();
      // The kitchen board and the badges have a new ticket to show.
      router.refresh();
    } catch {
      toast(t("done.networkError"), "error");
    } finally {
      setBusy(false);
    }
  }

  return { charge, busy, pending, setPending, ticket, setTicket };
}
