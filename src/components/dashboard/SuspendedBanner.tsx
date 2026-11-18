"use client";

import { useT } from "@/lib/i18n/context";
import { SuspendIcon } from "@/components/ui/icons";

interface SuspendedBannerProps {
  reason: string | null | undefined;
}

/**
 * The restaurant is suspended by the platform. Every screen says so, to the
 * whole team: the till, the tables and the diners' menu all refuse new sales,
 * and a cashier ringing one should know why before it is refused.
 */
export default function SuspendedBanner({ reason }: SuspendedBannerProps) {
  const t = useT();
  return (
    <div className="tt-frozen-banner" role="status">
      <span className="tt-frozen-text">
        <SuspendIcon size={15} weight="bold" aria-hidden="true" />
        {t("adminSuspend.banner", { reason: t(`adminSuspend.reason_${reason ?? "other"}`) })}
      </span>
    </div>
  );
}
