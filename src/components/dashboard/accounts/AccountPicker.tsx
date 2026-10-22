"use client";

import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import { balancesLabel } from "@/lib/currency-balances";
import { headroom } from "@/lib/accounts";
import { useOpenAccounts, type AccountListItem } from "@/hooks/useOpenAccounts";

interface AccountPickerProps {
  /** Loads the list only while it is on screen. */
  active: boolean;
  /** What would go on the account, to say which accounts have room for it. */
  amount: number;
  currency: string;
  onPick: (account: AccountListItem) => void;
  busy?: boolean;
}

/**
 * Choosing whose account a bill or a sale goes on: the open accounts, found by
 * name, each with what it owes and whether this amount still fits under its
 * ceiling. One that would pass it is shown and not offered — the database
 * would refuse it, and the cashier should know before pressing, not after.
 */
export default function AccountPicker({ active, amount, currency, onPick, busy = false }: AccountPickerProps) {
  const t = useT();
  const { accounts, failed, reload } = useOpenAccounts(active);
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (accounts ?? [])
      .filter(a => a.status === "open")
      .filter(a => !q || a.name.toLowerCase().includes(q));
  }, [accounts, query]);

  if (failed) {
    return (
      <p className="tt-field-error" role="alert">
        {t("accounts.loadFailed")}{" "}
        <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={reload}>
          {t("fallback.retry")}
        </button>
      </p>
    );
  }
  if (!accounts) return <p className="tt-muted">{t("common.loading")}</p>;
  if (!accounts.some(a => a.status === "open")) return <p className="tt-muted">{t("accounts.noneOpen")}</p>;

  return (
    <div className="tt-account-picker">
      <input
        className="tt-input"
        placeholder={t("accounts.searchName")}
        value={query}
        onChange={e => setQuery(e.target.value)}
        aria-label={t("accounts.searchName")}
      />
      <ul className="tt-account-picker-list">
        {shown.map(a => {
          const debt = a.balances?.find(b => b.currency === currency)?.amount ?? (a.currency === currency || !a.balances ? a.owed : 0);
          const room = headroom(debt, Number(a.credit_limit));
          const otherCurrency = a.balances?.some(b => b.amount > 0 && b.currency !== currency) ?? false;
          const fits = !otherCurrency && amount <= room + 0.005;
          const paying = Boolean(a.checkout_until && new Date(a.checkout_until) > new Date());
          return (
            <li key={a.id}>
              <button
                type="button"
                className="tt-account-pick"
                disabled={busy || !fits}
                onClick={() => onPick(a)}
              >
                <span className="tt-account-pick-name">{a.name}</span>
                <span className="tt-muted tt-account-pick-owed">
                  {t("accounts.owesOf", {
                    owed: balancesLabel(a.balances ?? [{ currency: a.currency ?? currency, amount: a.owed }]),
                    limit: formatMoney(Number(a.credit_limit), currency),
                  })}
                </span>
                {!fits && <span className="tt-field-error">{t(otherCurrency ? "apiErr.accountCurrency" : "accounts.wouldPassLimit")}</span>}
                {fits && paying && <span className="tt-muted">{t("accounts.payingNow")}</span>}
              </button>
            </li>
          );
        })}
        {shown.length === 0 && <li className="tt-muted">{t("accounts.noMatch")}</li>}
      </ul>
    </div>
  );
}
