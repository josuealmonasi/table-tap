"use client";

import { useCallback, useRef, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { redeemRequest, forgetRedeemRequest } from "@/lib/loyalty/redeem-request";

/** One staff action on a visit card: a stamp, a redemption, an undone visit. */
export interface LoyaltyCommand {
  path: string;
  method?: "POST" | "DELETE";
  body: object;
  /** A redemption: the card's code and the round and step on screen. */
  redeem?: { code: string; round: number | null | undefined; step: number | undefined };
}

export type LoyaltyAnswer =
  | { status: "done"; data: Record<string, unknown> }
  | { status: "refused" | "failed"; error: string }
  | { status: "busy" };

/**
 * Sends a visit-card action, one at a time, the same way from every screen.
 *
 * Quick stamping (Sellar tarjeta) and the card lookup each had this whole
 * lifecycle written out, and the two copies had to agree on the parts that
 * matter: a redemption is sent with the saved request for the round and step
 * on screen (S15), so a dropped answer retried is the same request and never
 * a second reward; that saved request is forgotten only once the answer is
 * on screen; and nothing is ever queued, because a stamp replayed on
 * reconnect is a second visit.
 */
export function useLoyaltyCommand(): { busy: boolean; run: (command: LoyaltyCommand) => Promise<LoyaltyAnswer> } {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);

  const run = useCallback(async (command: LoyaltyCommand): Promise<LoyaltyAnswer> => {
    if (sending.current) return { status: "busy" };
    sending.current = true;
    setBusy(true);
    let request: ReturnType<typeof redeemRequest> | undefined;
    try {
      if (command.redeem) {
        const { code, round, step } = command.redeem;
        if (typeof round !== "number" || step === undefined) return { status: "refused", error: t("apiErr.loyaltyRoundChanged") };
        try {
          request = redeemRequest(code, round, step);
        } catch {
          return { status: "refused", error: t("loyalty.saveRetry") };
        }
      }
      const res = await fetch(command.path, {
        method: command.method ?? "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request ?? command.body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return { status: "refused", error: (data.error as string | undefined) ?? t("apiErr.generic") };
      // The answer is already on its way to the screen. A cleanup failure must
      // not turn a successful handover into an error inviting another try.
      if (request) { try { forgetRedeemRequest(request); } catch {} }
      return { status: "done", data };
    } catch {
      // A redemption keeps its saved key until the same handover is answered.
      return { status: "failed", error: t("done.networkError") };
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }, [t]);

  return { busy, run };
}
