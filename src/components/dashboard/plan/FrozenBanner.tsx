"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/context";
import { SecureIcon } from "@/components/ui/icons";

/**
 * Says the dashboard is read-only, on every dashboard screen.
 *
 * `dashboardFrozen` lived only on the server: the API answered 402 to every
 * write while the dashboard went on rendering enabled buttons and inputs — 33
 * of them on the promotions page alone. An owner could edit their menu, flip a
 * setting and build a promotion, and every save failed with an error they had
 * no way to see coming.
 *
 * A banner rather than disabling every control: the panel has dozens across a
 * dozen files, and a disabled button still owes the person a reason. This says
 * the reason once, at the top, and points at the page that fixes it.
 *
 * Shown to the whole team, not just the owner — a manager saving settings hits
 * the same 402 — but only the owner is offered the billing link, because only
 * they can act on it.
 */
export default function FrozenBanner({ isOwner }: { isOwner: boolean }) {
  const t = useT();
  return (
    <div className="tt-frozen-banner" role="status">
      <span className="tt-frozen-text">
        <SecureIcon size={15} weight="bold" aria-hidden="true" />
        {t("plan.frozenBanner")}
      </span>
      {isOwner && (
        <Link href="/dashboard/plan" className="tt-btn tt-btn-sm tt-btn-primary">
          {t("plan.frozenFix")}
        </Link>
      )}
    </div>
  );
}
