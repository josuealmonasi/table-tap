"use client";

import { useLocale, useT } from "@/lib/i18n/context";
import { billingSummary, type RestaurantBilling } from "@/lib/admin-billing-summary";

interface AdminBillingLineProps {
  billing: RestaurantBilling;
}

/** How a restaurant pays for its plan, in one line under its name. */
export default function AdminBillingLine({ billing }: AdminBillingLineProps) {
  const t = useT();
  const { locale } = useLocale();
  const { text, tone } = billingSummary(billing, t, locale);
  const toneClass = tone === "warn" || tone === "danger" ? ` tt-admin-billing--${tone}` : "";
  return <span className={`tt-admin-billing${toneClass}`} title={text}>{text}</span>;
}
