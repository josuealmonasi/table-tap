"use client";

import { rememberLastSale } from "@/lib/pos-last-sale";
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
import type { HeldSale } from "@/lib/offline-sales";
import { offlineReceipt } from "@/lib/offline-receipt";
import { orderCode } from "@/lib/types";
import { useLocale } from "@/lib/i18n/context";
import { dateLocale } from "@/lib/format";

interface PosChargeInput {
  restaurant: Restaurant;
  cart: ReturnType<typeof usePosCart>;
  details: ReturnType<typeof usePosSaleDetails>;
  /** False when no mail provider is configured — then emailing is not offered. */
  canEmailReceipt: boolean;
  /** What the till prices the sale at: offline, it is also what is charged. */
  pricing: { subtotal: number; serviceFee: number; tip: number; discount: number; total: number };
  /** The device's own store, for a sale rung with no connection. */
  offline: { hold: (sale: HeldSale) => boolean; acknowledge: (sale: HeldSale, data: unknown) => boolean; setOnline: (online: boolean) => void };
}

export function usePosCharge({ restaurant, cart, details, canEmailReceipt, pricing, offline }: PosChargeInput) {
  const t = useT();
  const { locale } = useLocale();
  const toast = useToast();
  const router = useRouter();
  const { lines } = cart;
  const { tipPct, tipCustom } = details;
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState<PosTicket | null>(null);
  /** How the customer is paying, asked about before the sale is sent. */
  const [pending, setPending] = useState<"cash" | "card" | null>(null);

  const money = (n: number) => formatMoney(n, restaurant.currency);

  function printReceipt(html: string): void {
    const w = window.open("", "_blank", "width=380,height=640");
    if (!w) {
      toast(t("pos.printBlocked"), "error");
      return;
    }
    w.document.write(printableReceipt(html, restaurant.name));
    w.document.close();
    w.focus();
    printWhenReady(w);
  }

  /** The held sale is already durable; a missing answer must keep its original time. */
  function showHeld(sale: HeldSale): void {
    if (!details.noTicket) {
      printReceipt(offlineReceipt(
        { posRef: sale.posRef, at: sale.at, lines: sale.items, charge: sale.charge, method: sale.method, currency: restaurant.currency },
        { name: restaurant.name, timeZone: restaurant.timezone ?? "America/Mexico_City", locale: dateLocale(locale) }, t,
      ));
    }
    setTicket({ code: orderCode(sale.posRef), total: sale.charge.total, handedOver: true, offline: true });
    rememberLastSale(restaurant.id, sale.items);
    cart.clear();
    details.reset();
  }

  /** Ring it up. The money is already in the drawer by the time this runs. */
  async function charge(
    method: "cash" | "card" | "account",
    account?: AccountListItem,
  ): Promise<void> {
    if (lines.length === 0 || busy) return;
    setPending(null);
    // Keep the same reference when a missing response sends the sale to replay.
    const posRef = crypto.randomUUID();
    const sale: HeldSale | null = method === "account" ? null : {
      posRef, restaurantId: restaurant.id, at: new Date().toISOString(), method, items: lines,
      charge: { ...pricing }, tipPct: tipCustom === null ? tipPct : undefined, tipAmount: tipCustom ?? undefined,
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
    try {
      let res: Response;
      try {
        res = await fetch("/api/pos/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            posRef,
            collected: sale ? { at: sale.at, ...sale.charge } : undefined,
            items: lines,
            method,
            accountId: account?.id,
            customerName: details.customerName.trim() || undefined,
            note: details.note.trim() || undefined,
            tipPct: account ? undefined : tipCustom === null ? tipPct : undefined,
            tipAmount: account ? undefined : (tipCustom ?? undefined),
            email:
              canEmailReceipt && !details.noTicket
                ? details.email.trim() || undefined
                : undefined,
            noReceipt: details.noTicket || undefined,
            terminalRef: method === "card" ? details.terminalRef.trim() || undefined : undefined,
          }),
        });
      } catch {
        offline.setOnline(false);
        if (sale) showHeld(sale);
        else toast(t("done.networkError"), "error");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (sale) showHeld(sale);
        if (data.code === "outOfStock") {
          toast(shortMessage(data.short ?? [], t), "error");
        } else {
          toast(data.error ?? t("done.networkError"), "error");
        }
        return;
      }
      if (sale && !offline.acknowledge(sale, data)) {
        showHeld(sale);
        toast(t("pos.saleNeedsReview"), "error");
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
      if (data.receiptHtml) printReceipt(data.receiptHtml);
      setTicket({
        code: data.code,
        total: data.total,
        handedOver: Boolean(data.handedOver),
      });
      rememberLastSale(restaurant.id, cart.lines);
      cart.clear();
      details.reset();
      router.refresh();
    } catch {
      if (sale) showHeld(sale);
      toast(t("done.networkError"), "error");
    } finally {
      setBusy(false);
    }
  }

  return { charge, busy, pending, setPending, ticket, setTicket };
}
