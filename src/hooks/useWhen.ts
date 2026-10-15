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
