"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/context";

/** Shown on the console until the platform admin turns on two-step verification. */
export default function AdminMfaNudge() {
  const t = useT();
  return (
    <div className="tt-frozen-banner tt-trial-banner" role="status">
      <span className="tt-frozen-text">{t("adminMfa.nudge")}</span>
      <Link href="/dashboard/admin/mfa" className="tt-btn tt-btn-sm tt-btn-primary">{t("adminMfa.turnOn")}</Link>
    </div>
  );
}
