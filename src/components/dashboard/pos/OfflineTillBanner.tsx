"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/context";
import type { HeldSale } from "@/lib/offline-sales";
import { WarningIcon } from "@/components/ui/icons";

interface OfflineTillBannerProps {
  online: boolean;
  held: HeldSale[];
  onRetry: () => void;
  canRecover?: boolean;
}

/**
 * What the till is doing with the connection, said plainly: selling without
 * one, sending what it held, or unable to send a sale — which is money taken
 * and not yet recorded anywhere but this device, so it says who to tell.
 */
export default function OfflineTillBanner({ online, held, onRetry, canRecover = false }: OfflineTillBannerProps) {
  const t = useT();
  const refused = held.filter(s => s.error);
  if (online && held.length === 0) return null;
  return (
    <div className={`tt-offline-till ${refused.length ? "tt-offline-till-refused" : ""}`} role="status">
      <WarningIcon size={18} weight="bold" aria-hidden="true" />
      <div>
        {!online && <p>{t("pos.offlineBanner")}</p>}
        {held.length > 0 && (
          <p>
            {online ? t("pos.offlineSending", { n: held.length }) : t("pos.offlineHeldCount", { n: held.length })}
          </p>
        )}
        {canRecover && online && held.length > 0 && <p><Link href="/dashboard/held-sales">{t("recovery.open")}</Link></p>}
        {refused.length > 0 && (
          <p>
            {t("pos.offlineRefused", { n: refused.length, reason: refused[0].error ?? "" })}{" "}
            {online && (
              <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={onRetry}>
                {t("pos.offlineRetry")}
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
