"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useT } from "@/lib/i18n/context";
import { formatMoney, dateLocale } from "@/lib/format";
import { qrSvg } from "@/lib/qr";
import { BackIcon } from "@/components/ui/icons";
import TipPicker from "@/components/customer/TipPicker";
import StatementDays from "./StatementDays";
import StatementSkeleton from "./StatementSkeleton";
import type { StatementDay } from "@/lib/accounts";

interface Statement {
  restaurant: { id: string; name: string; logo: string | null; logo_url: string | null; currency: string };
  name: string;
  status: "open" | "closed";
  owed: number;
  days: StatementDay[];
  payments: { at: string; amount: number; tip: number; method: "cash" | "card" }[];
  cardsEnabled: boolean;
  payingOnline: boolean;
  canEmail: boolean;
  timeZone: string | null;
}

/**
 * The customer's statement: what their account owes, day by day, and the two
 * ways to pay it — by card here, or at the till, where the cashier scans this
 * page's own code and the customer decides the tip there. Printing it and
 * sending it by email are for keeping it; the page is the statement.
 */
export default function AccountStatement({ code, paid }: { code: string; paid: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const [data, setData] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"none" | "online" | "till" | "mail">("none");
  const [tipPct, setTipPct] = useState(0);
  const [tipCustom, setTipCustom] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [svg, setSvg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/account?c=${code}`);
      const d = await res.json();
      if (!res.ok) setError(d.error ?? t("apiErr.generic"));
      else setData(d);
    } catch {
      setError(t("done.networkError"));
    }
  }, [code, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Back from Stripe: the webhook records the payment a moment later, so ask
  // again until the balance says so rather than claiming it already has.
  useEffect(() => {
    if (!paid || !data || data.owed === 0) return;
    const id = setTimeout(() => void load(), 2500);
    return () => clearTimeout(id);
  }, [paid, data, load]);

  useEffect(() => {
    if (mode !== "till") return;
    let live = true;
    void qrSvg(window.location.href.split("?")[0]).then(s => live && setSvg(s));
    return () => {
      live = false;
    };
  }, [mode]);

  if (error) {
    return (
      <div className="tt-login-card">
        <p className="tt-field-error" role="alert">{error}</p>
        <button type="button" className="tt-btn tt-btn-ghost" onClick={() => void load()}>{t("fallback.retry")}</button>
      </div>
    );
  }
  if (!data) return <StatementSkeleton />;

  const money = (n: number) => formatMoney(n, data.restaurant.currency);
  const tip = Math.min(Math.max(0, tipCustom ?? Math.round(data.owed * tipPct) / 100), data.owed);

  async function payOnline(): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/account/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ c: code, expected: data!.owed, tipAmount: tip }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.url) {
        setNotice(d.error ?? t("apiErr.generic"));
        if (res.status === 409) void load();
        return;
      }
      window.location.href = d.url;
    } catch {
      setNotice(t("done.networkError"));
    } finally {
      setBusy(false);
    }
  }

  async function mail(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/account/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ c: code, email }),
      });
      const d = await res.json().catch(() => ({}));
      setNotice(res.ok ? t("account.mailSent", { email }) : d.error ?? t("apiErr.generic"));
      if (res.ok) setEmail("");
    } catch {
      setNotice(t("done.networkError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Link href={`/r/${data.restaurant.id}`} className="tt-btn tt-btn-ghost tt-btn-sm tt-rewards-back tt-no-print">
        <BackIcon size={14} weight="bold" aria-hidden="true" />
        {t("rewards.backToMenu")}
      </Link>
      <div className="tt-login-card tt-statement-card">
        <p className="tt-muted" style={{ margin: 0 }}>{data.restaurant.name}</p>
        <h1 className="tt-serif" style={{ margin: "4px 0 8px" }}>{t("account.title", { name: data.name })}</h1>

        {paid && data.owed > 0 && <p className="tt-rewards-notice" role="status">{t("account.confirming")}</p>}
        {paid && data.owed === 0 && <p className="tt-rewards-notice" role="status">{t("account.paidThanks")}</p>}

        <p className="tt-statement-owed">
          {data.owed > 0 ? t("account.owed", { amount: money(data.owed) }) : t("account.nothingOwed")}
        </p>

        <StatementDays days={data.days} currency={data.restaurant.currency} timeZone={data.timeZone ?? undefined} />

        {data.payments.length > 0 && (
          <details className="tt-statement-paid">
            <summary>{t("account.paidBefore")}</summary>
            <ul>
              {data.payments.map((p, i) => (
                <li key={i}>
                  {new Intl.DateTimeFormat(dateLocale(locale), { dateStyle: "medium" }).format(new Date(p.at))} ·{" "}
                  {money(p.amount)} · {t(p.method === "cash" ? "account.byCash" : "account.byCard")}
                </li>
              ))}
            </ul>
          </details>
        )}

        {notice && <p className="tt-field-error" role="status">{notice}</p>}

        {data.owed > 0 && data.payingOnline && mode !== "online" && (
          <p className="tt-muted" role="status">{t("account.payingOnlineNow")}</p>
        )}

        {data.owed > 0 && (
          <div className="tt-statement-actions tt-no-print">
            {mode === "online" ? (
              <>
                <div className="tt-pos-tip">
                  <TipPicker
                    currency={data.restaurant.currency}
                    tipPct={tipCustom !== null ? 0 : tipPct}
                    tipCustom={tipCustom}
                    maxTip={data.owed}
                    onPresetTip={pct => {
                      setTipCustom(null);
                      setTipPct(pct);
                    }}
                    onCustomTip={amount => {
                      setTipCustom(amount);
                      if (amount !== null) setTipPct(0);
                    }}
                  />
                </div>
                <button type="button" className="tt-btn tt-btn-primary tt-btn-lg" disabled={busy} onClick={() => void payOnline()}>
                  {t("account.payTotal", { amount: money(data.owed + tip) })}
                </button>
              </>
            ) : mode === "till" ? (
              <div className="tt-statement-till">
                <p>{t("account.tillHint")}</p>
                {svg && <div className="tt-account-qr-img" dangerouslySetInnerHTML={{ __html: svg }} />}
              </div>
            ) : null}
            {mode !== "online" && data.cardsEnabled && !data.payingOnline && (
              <button type="button" className="tt-btn tt-btn-primary tt-btn-lg" onClick={() => setMode("online")}>
                {t("account.payOnline")}
              </button>
            )}
            {mode !== "till" && (
              <button type="button" className="tt-btn tt-btn-ghost tt-btn-lg" onClick={() => setMode("till")}>
                {t("account.payAtTill")}
              </button>
            )}
          </div>
        )}

        <div className="tt-statement-keep tt-no-print">
          <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => window.print()}>
            {t("account.print")}
          </button>
          {data.canEmail && mode !== "mail" && (
            <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => setMode("mail")}>
              {t("account.email")}
            </button>
          )}
        </div>
        {mode === "mail" && (
          <form className="tt-row tt-no-print" style={{ gap: 8, marginTop: 8 }} onSubmit={e => void mail(e)}>
            <input className="tt-input" type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder={t("account.emailPlaceholder")} aria-label={t("account.emailPlaceholder")} required />
            <button type="submit" className="tt-btn tt-btn-primary tt-btn-sm" disabled={busy}>{t("account.send")}</button>
          </form>
        )}
        <p className="tt-muted" style={{ fontSize: 12, marginTop: 16 }}>{t("account.privacy")}</p>
      </div>
    </>
  );
}
