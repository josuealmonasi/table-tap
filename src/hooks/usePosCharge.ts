"use client";

import type { PendingOrderDetails } from "@/components/ui/PendingOrder";
import { rememberLastSale } from "@/lib/pos-last-sale";
import { refusalSettles } from "@/hooks/useRetryIntent";
import { useRef, useState } from "react";
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
import type { HeldSale } from "@/lib/offline-sales";
import { offlineReceipt } from "@/lib/offline-receipt";
import { orderCode } from "@/lib/types";
import { useLocale } from "@/lib/i18n/context";
import { dateLocale } from "@/lib/format";

export interface PendingAccountSale extends PendingOrderDetails {
  name: string;
  amount: number;
  currency: string;
}

interface PosChargeInput {
  collectorContext: string;
  collector: string;
  restaurant: Restaurant;
  cart: ReturnType<typeof usePosCart>;
  details: ReturnType<typeof usePosSaleDetails>;
  /** False when no mail provider is configured — then emailing is not offered. */
  canEmailReceipt: boolean;
  /** What the till prices the sale at: offline, it is also what is charged. */
  pricing: { subtotal: number; serviceFee: number; tip: number; discount: number; total: number };
  /** The device's own store, for a sale rung with no connection. */
  offline: {
    hold: (sale: HeldSale) => boolean;
    acknowledge: (sale: HeldSale, data: unknown) => boolean;
    discard: (sale: HeldSale) => void;
    setOnline: (online: boolean) => void;
  };
}

/**
 * Ringing a sale at the till: the request, the answer, and the ticket.
 *
 * Nothing reaches the server until the money is in the drawer, and then it is
 * one request that creates the order already paid and already on the pass.
 * The sale is saved on the device before that request leaves, and let go only
 * when the server says it is settled — a hung request or a restarted tablet
 * must not erase money already taken.
 */
export function usePosCharge({ collector, collectorContext, restaurant, cart, details, canEmailReceipt, pricing, offline }: PosChargeInput) {
  const t = useT();
  const { locale } = useLocale();
  const toast = useToast();
  const router = useRouter();
  const { lines } = cart;
  const { tipPct, tipCustom } = details;
  const accountRequest = useRef<string | null>(null);
  const accountReview = useRef<{ name: string; amount: number; currency: string } | null>(null);
  const inFlight = useRef(false);
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

  /**
   * The sale stays on this device: give the customer their ticket, and send it
   * when the connection returns. It is already saved, with the time it was
   * taken, so a late send records it as it happened. Only money already in
   * hand — an account's ceiling cannot be checked without the server.
   */
  function showHeld(sale: HeldSale, answered = false): void {
    if (!details.noTicket) {
      printReceipt(offlineReceipt(
        { posRef: sale.posRef, at: sale.at, lines: sale.items, charge: sale.charge, method: sale.method, currency: restaurant.currency },
        { name: restaurant.name, timeZone: restaurant.timezone ?? "America/Mexico_City", locale: dateLocale(locale) }, t,
      ));
    }
    setTicket({ code: orderCode(sale.posRef), total: sale.charge.total, handedOver: true, offline: true, answered });
    rememberLastSale(restaurant.id, sale.items);
    cart.clear();
    details.reset();
  }

  /** Ring it up. The money is already in the drawer by the time this runs. */
  async function charge(
    method: "cash" | "card" | "account",
    account?: AccountListItem,
  ): Promise<void> {
    if (inFlight.current || busy || (lines.length === 0 && !accountRequest.current)) return;
    if (accountRequest.current) method = "account";
    setPending(null);
    // One reference per sale, made before anything is sent: a request that
    // dies on the way and is held and sent again is the same sale, rung once.
    const posRef = accountRequest.current ? JSON.parse(accountRequest.current).posRef as string : crypto.randomUUID();
    const sale: HeldSale | null = method === "account" ? null : {
      posRef, collector, collectorContext, restaurantId: restaurant.id, at: new Date().toISOString(), method, items: lines,
      charge: { ...pricing }, currency: restaurant.currency, tipPct: tipCustom === null ? tipPct : undefined, tipAmount: tipCustom ?? undefined,
      customerName: details.customerName.trim() || undefined, note: details.note.trim() || undefined,
      terminalRef: method === "card" ? details.terminalRef.trim() || undefined : undefined,
    };
    // Save before fetch: a hung request and a tablet restart must not erase collected money.
    if (sale && !offline.hold(sale)) {
      toast(t("pos.offlineNoStorage"), "error");
      return;
    }
    if (!navigator.onLine) {
      offline.setOnline(false);
      if (sale) showHeld(sale);
      else toast(t("pos.offlineNoAccount"), "error");
      return;
    }
    setBusy(true);
    inFlight.current = true;
    try {
      let res: Response;
      try {
        const request = JSON.stringify({
          posRef,
          collectorContext,
          currency: restaurant.currency,
          restaurantId: restaurant.id,
          collected: sale ? { at: sale.at, ...sale.charge } : undefined,
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
          terminalRef: method === "card" ? details.terminalRef.trim() || undefined : undefined,
        });
        if (method === "account" && !accountRequest.current) {
          accountRequest.current = request;
          accountReview.current = { name: account?.name ?? account?.id ?? "", amount: Math.round((pricing.total - pricing.tip) * 100) / 100, currency: restaurant.currency };
        }
        res = await fetch("/api/pos/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: accountRequest.current ?? request,
        });
      } catch {
        // The request never came back. If it never arrived, holding it is the
        // only record of the sale; if it did, sending it again is answered
        // with the sale it already rang.
        offline.setOnline(false);
        if (sale) showHeld(sale);
        else toast(t("done.networkError"), "error");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if ((res.ok || refusalSettles(res.status)) && !data.held) accountRequest.current = null;
        // A refusal is the sale not happening — out of stock, the menu closed,
        // an account at its ceiling. The held copy goes and the cart stays, so
        // the cashier fixes it or hands the money back, as before the till
        // held sales. Kept, the copy would be sent again through the offline
        // path, which floors stock instead of refusing, and ring the very sale
        // that was refused. Only an answer that says nothing (a 5xx), or one
        // that says the money is already in the drawer (`held`), keeps the
        // sale on this device.
        if (sale && (res.status >= 500 || data.held)) showHeld(sale, true);
        else if (sale) offline.discard(sale);
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
      if (sale && !offline.acknowledge(sale, data)) {
        showHeld(sale, true);
        toast(t("pos.saleNeedsReview"), "error");
        return;
      }
      if (method === "account" && (!data.settled || !data.onAccount)) {
        toast(t("done.networkError"), "error");
        return;
      }
      accountRequest.current = null;
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
      // Kept on this device, so the next "same again" is one tap.
      rememberLastSale(restaurant.id, cart.lines);
      cart.clear();
      details.reset();
      // The kitchen board and the badges have a new ticket to show.
      router.refresh();
    } catch {
      if (sale) showHeld(sale);
      toast(t("done.networkError"), "error");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const accountRetry: PendingAccountSale | null = accountRequest.current && accountReview.current
    ? { ...JSON.parse(accountRequest.current), ...accountReview.current } : null;
  return { charge, busy, pending, setPending, ticket, setTicket, accountRetry };
}
