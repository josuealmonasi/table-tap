"use client";

import { useEffect, useState } from "react";
import { useLocale, useT } from "@/lib/i18n/context";
import { formatAgo } from "@/lib/elapsed";
import { minutesWaiting, waitLevel } from "@/lib/ticket-wait";

interface TicketWaitProps {
  createdAt: string;
  /** The clock time it was placed, for the tooltip and the first paint. */
  placedAt: string;
  warnMinutes: number;
  lateMinutes: number;
}

/**
 * How long a ticket has waited ("hace 12 min", "hace 1 d 5 h"), amber past the
 * restaurant's first threshold and red past the second, so the cook does not
 * have to subtract clock times.
 *
 * Measured after mount and again every 30 seconds, like the Bills list: a
 * relative time rendered on the server is a different sentence by the time it
 * reaches the browser, and React would report a hydration mismatch. Its own
 * component, so the tick re-renders this line and not the whole card.
 */
export default function TicketWait({ createdAt, placedAt, warnMinutes, lateMinutes }: TicketWaitProps) {
  const t = useT();
  const { locale } = useLocale();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  if (now === null) return <span className="tt-muted" style={{ fontSize: 12 }}>{placedAt}</span>;
  // The colour still counts minutes against the thresholds; only the words
  // change unit.
  const minutes = minutesWaiting(createdAt, now);
  const level = waitLevel(minutes, warnMinutes, lateMinutes);
  return (
    <span
      className={`tt-ticket-wait tt-ticket-wait-${level}`}
      title={t("ticketTimes.placedAt", { time: placedAt })}
    >
      {formatAgo(createdAt, now, locale)}
    </span>
  );
}
