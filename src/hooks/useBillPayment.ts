"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { rememberSettling } from "@/hooks/useReceiptOffer";

/**
 * The three ways a diner settles a table's bill from their phone: online for
 * the whole bill or their part of it, their share of a divided bill, or
 * calling somebody over to take the money.
 *
 * Only a redirect leaves the screen. Anything else says so, in the server's
 * own words: every refusal already carries a sentence in the diner's language,
 * and reporting all of them as "network error, try again" sent a table of
 * twelve to press the same button again — and each press opens a Stripe
 * session.
 */
export function useBillPayment(
  restaurantId: string,
  tableId: string,
  sessionId: string | null,
) {
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [called, setCalled] = useState(false);

  /** Follows a checkout url, or says why there is none. */
  async function redirectOrSay(res: Response, before?: () => void): Promise<void> {
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (data.url) {
      before?.();
      window.location.href = data.url;
    } else {
      toast(data.error ?? t("done.networkError"), "error");
      setBusy(false);
    }
  }

  /** Their share, plus anything they ordered since it froze. */
  async function payShare(share: {
    splitId: string;
    diner: string;
    ownOrderIds: string[];
    tipPct: number;
  }): Promise<void> {
    if (!sessionId || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/split/pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          splitId: share.splitId,
          sessionId,
          diner: share.diner,
          restaurantId,
          tableId,
          // Which orders this phone believes are its own. Checked on the server
          // against what was actually placed after the freeze.
          ownOrderIds: share.ownOrderIds,
          tipPct: share.tipPct,
        }),
      });
      await redirectOrSay(res);
    } catch {
      toast(t("done.networkError"), "error");
      setBusy(false);
    }
  }

  async function payOnline(pay: {
    orderIds: string[];
    couponCode?: string;
    tipPct: number;
    tipCustom: number | null;
  }): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch("/api/bill/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantId,
          tableId,
          // Which orders, and how much to add on top. The food's price is
          // summed from the stored rows either way.
          orderIds: pay.orderIds,
          couponCode: pay.couponCode,
          tipPct: pay.tipCustom === null ? pay.tipPct : undefined,
          tipAmount: pay.tipCustom ?? undefined,
        }),
      });
      // Stripe sends them back to the menu, where the bill is already gone —
      // so what they just paid for is noted here, while it is still known,
      // for the receipt offer waiting on the other side.
      await redirectOrSay(res, () => rememberSettling(pay.orderIds));
    } catch {
      toast(t("done.networkError"), "error");
      setBusy(false);
    }
  }

  /**
   * Ask for somebody to come and take the money.
   *
   * The answer is read. It used to be thrown away, and "a waiter is on the
   * way" was shown whatever came back — a rate limit, a table that no longer
   * exists, a server that was down. Telling a table somebody is coming when
   * nobody has been told is the worst version of this screen's one job.
   */
  async function payAtTable(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch("/api/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId, tableId, kind: "pay" }),
      });
      if (res.ok) {
        setCalled(true);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast(data.error ?? t("done.networkError"), "error");
    } catch {
      toast(t("done.networkError"), "error");
    } finally {
      setBusy(false);
    }
  }

  return { busy, called, payShare, payOnline, payAtTable };
}
