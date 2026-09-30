"use client";

import { useLocale, useT } from "@/lib/i18n/context";
import { formatMoney, dateLocale } from "@/lib/format";
import type { StatementDay } from "@/lib/accounts";

interface StatementDaysProps {
  days: (Omit<StatementDay, "charges"> & {
    charges: (StatementDay["charges"][number] & { chargedBy?: string | null })[];
  })[];
  currency: string;
  timeZone?: string;
}

/**
 * What an account owes, day by day, with the time and the dishes of each
 * charge — the list a customer checks before paying, and the one the till
 * reads back to them. The staff's copy also names who put each charge on.
 */
export default function StatementDays({ days, currency, timeZone }: StatementDaysProps) {
  const t = useT();
  const { locale } = useLocale();
  const day = (key: string) =>
    new Intl.DateTimeFormat(dateLocale(locale), { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
      .format(new Date(`${key}T12:00:00Z`));
  const time = (iso: string) =>
    new Intl.DateTimeFormat(dateLocale(locale), { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(iso));
  const money = (n: number) => formatMoney(n, currency);

  if (days.length === 0) return <p className="tt-muted">{t("account.nothingOwed")}</p>;

  return (
    <div className="tt-statement">
      {days.map(d => (
        <section key={d.day} className="tt-statement-day">
          <header className="tt-statement-day-head">
            <strong>{day(d.day)}</strong>
            <span>{money(d.total)}</span>
          </header>
          {d.charges.map((c, i) => (
            <div key={`${c.at}-${i}`} className="tt-statement-charge">
              <div className="tt-statement-charge-head">
                <span className="tt-muted">
                  {time(c.at)}
                  {c.tableLabel ? ` · ${c.tableLabel}` : ""}
                  {c.chargedBy ? ` · ${t("account.chargedBy", { who: c.chargedBy })}` : ""}
                </span>
                <span>{money(c.total)}</span>
              </div>
              <ul className="tt-statement-lines">
                {c.lines.map((l, j) => (
                  <li key={j}>
                    <span>
                      {l.qty}× {l.emoji ? `${l.emoji} ` : ""}{l.name}
                      {l.extras.length > 0 && <span className="tt-muted"> + {l.extras.join(", ")}</span>}
                    </span>
                    <span className="tt-muted">{money(l.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
