"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Modal } from "@/components/ui/Modal";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateLocale } from "@/lib/format";
import { planLabel } from "@/lib/plan";
import type { TrialNotice } from "@/lib/trial-notice";

interface Props { restaurantId: string; notice: TrialNotice }

const seenKey = (id: string) => `tt-trial-welcome:${id}`;

/**
 * Shown once, the first time a new owner reaches the dashboard: the month is
 * free, nothing is charged, and what they fall back to afterwards. Remembered
 * per restaurant on this device.
 */
export default function TrialWelcome({ restaurantId, notice }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try { setOpen(!localStorage.getItem(seenKey(restaurantId))); } catch { setOpen(false); }
  }, [restaurantId]);
  const close = () => {
    try { localStorage.setItem(seenKey(restaurantId), "1"); } catch { /* private mode: it shows again */ }
    setOpen(false);
  };
  if (!open) return null;
  const plan = planLabel(notice.plan);
  const ends = new Date(notice.endsAt).toLocaleDateString(dateLocale(locale), { day: "numeric", month: "long", timeZone: "America/Mexico_City" });
  return (
    <Modal open onClose={close} maxWidth={480} title={t("trial.welcomeTitle", { plan })}>
      <p style={{ marginTop: 0 }}>{t("trial.welcomeFree", { plan, date: ends })}</p>
      <p className="tt-muted">{t("trial.welcomeAfter")}</p>
      <div className="tt-prodform-actions">
        <Link href="/dashboard/plan" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={close}>{t("trial.seePlans")}</Link>
        <button type="button" className="tt-btn tt-btn-primary tt-btn-sm" onClick={close}>{t("trial.start")}</button>
      </div>
    </Modal>
  );
}
