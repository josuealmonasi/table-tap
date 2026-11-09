"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";

/** A missing reply must not become an empty program someone can save over it. */
export default function LoyaltyReadError() {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <div className="tt-card" style={{ padding: 20 }} role="alert">
    <p>{t("loyalty.readFailed")}</p>
    <button type="button" className="tt-btn" disabled={pending}
      onClick={() => startTransition(() => router.refresh())}>
      {t("fallback.retry")}
    </button>
  </div>;
}
