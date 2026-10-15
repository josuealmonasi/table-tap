"use client";

import { useCallback } from "react";
import { useLocale } from "@/lib/i18n/context";
import { dateLocale } from "@/lib/format";

/**
 * "14 oct, 09:30" in the reader's language and the restaurant's clock: a
 * count taken at nine in the morning in Mexico City says nine wherever the
 * owner happens to be reading it.
 */
export function useWhen(timeZone?: string): (iso: string) => string {
  const { locale } = useLocale();
  return useCallback(
    (iso: string) =>
      new Date(iso).toLocaleString(dateLocale(locale), {
        timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
      }),
    [locale, timeZone],
  );
}

/** A calendar day, YYYY-MM-DD, as "jue 15 oct" in the reader's language. */
export function useDayLabel(): (day: string) => string {
  const { locale } = useLocale();
  return useCallback(
    (day: string) =>
      new Date(`${day}T12:00:00Z`).toLocaleDateString(dateLocale(locale), {
        timeZone: "UTC", weekday: "short", day: "numeric", month: "short",
      }),
    [locale],
  );
}

/** "09:30", on the restaurant's clock. */
export function useTimeLabel(timeZone?: string): (iso: string) => string {
  const { locale } = useLocale();
  return useCallback(
    (iso: string) => new Date(iso).toLocaleTimeString(dateLocale(locale), { timeZone, hour: "2-digit", minute: "2-digit" }),
    [locale, timeZone],
  );
}
