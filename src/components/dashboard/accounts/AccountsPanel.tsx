"use client";

import { useMemo, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import Breadcrumb from "@/components/layout/Breadcrumb";
import PlanLock from "@/components/dashboard/plan/PlanLock";
import QrScanner from "@/components/dashboard/QrScanner";
import { accountCodeFromScan } from "@/lib/scan-target";
import { useOpenAccounts, type AccountListItem } from "@/hooks/useOpenAccounts";
import { ListSkeleton } from "@/components/ui/Skeleton";
import OpenAccountDialog from "./OpenAccountDialog";
import AccountDialog from "./AccountDialog";

interface AccountsPanelProps {
  currency: string;
  timeZone: string;
  /** The tier carries accounts: new ones may be opened. */
  canOpen: boolean;
  unlocksWith: string;
  isOwner: boolean;
  canManage: boolean;
}

/**
 * Customer accounts: who owes what, found by name or by the QR on their
 * statement, and the door to opening one. On a tier without accounts the
 * existing ones stay here to be collected — what a customer owes does not
 * stop being owed because the restaurant changed plans.
 */
export default function AccountsPanel({ currency, timeZone, canOpen, unlocksWith, isOwner, canManage }: AccountsPanelProps) {
  const t = useT();
  const { accounts, failed, reload } = useOpenAccounts(true);
  const [query, setQuery] = useState("");
  const [opening, setOpening] = useState(false);
  const [shownId, setShownId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const money = (n: number) => formatMoney(n, currency);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (accounts ?? []).filter(a => !q || a.name.toLowerCase().includes(q));
  }, [accounts, query]);
  const current: AccountListItem | null = (accounts ?? []).find(a => a.id === shownId) ?? null;
  const owedTotal = (accounts ?? []).reduce((sum, a) => sum + a.owed, 0);

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb trail={[{ labelKey: "nav.dashboard", href: "/dashboard" }, { labelKey: "nav.accounts" }]} />
          <div className="tt-pos-head-actions">
            <QrScanner
              label={t("scan.button")}
              title={t("accounts.scanTitle")}
              hint={t("accounts.scanHint")}
              noCamera={t("scan.noCamera")}
              onRead={raw => {
                const code = accountCodeFromScan(raw);
                if (!code) return "keep-looking";
                const found = (accounts ?? []).find(a => a.code === code);
                if (found) setShownId(found.id);
                else setNotice(t("accounts.scanNotHere"));
                return "taken";
              }}
            />
            {canOpen && (
              <button type="button" className="tt-btn tt-btn-primary tt-btn-sm" onClick={() => setOpening(true)}>
                + {t("accounts.openAction")}
              </button>
            )}
          </div>
        </header>

        {!canOpen && <PlanLock feature="openAccounts" unlocksWith={unlocksWith} isOwner={isOwner} />}
        {notice && <p className="tt-field-error" role="status">{notice}</p>}

        <section className="tt-section">
          <p className="tt-muted" style={{ marginTop: 0, fontSize: 13 }}>
            {t("accounts.intro")}
            {accounts && owedTotal > 0 && ` ${t("accounts.owedTotal", { amount: money(owedTotal) })}`}
          </p>
          {failed ? (
            <p className="tt-field-error" role="alert">
              {t("accounts.loadFailed")}{" "}
              <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={reload}>{t("fallback.retry")}</button>
            </p>
          ) : !accounts ? (
            <ListSkeleton rows={3} />
          ) : accounts.length === 0 ? (
            <p className="tt-muted">{t(canOpen ? "accounts.empty" : "accounts.emptyLocked")}</p>
          ) : (
            <>
              <input
                className="tt-input"
                placeholder={t("accounts.searchName")}
                aria-label={t("accounts.searchName")}
                value={query}
                onChange={e => setQuery(e.target.value)}
                style={{ marginBottom: 10 }}
              />
              <ul className="tt-account-list">
                {shown.map(a => (
                  <li key={a.id}>
                    <button type="button" className="tt-account-row" onClick={() => setShownId(a.id)}>
                      <span className="tt-account-row-name">{a.name}</span>
                      <span className="tt-account-row-owed">
                        {a.status === "closed" ? (
                          <span className="tt-muted">{t("accounts.closedTag")}</span>
                        ) : (
                          t("accounts.owesOf", { owed: money(a.owed), limit: money(Number(a.credit_limit)) })
                        )}
                      </span>
                    </button>
                  </li>
                ))}
                {shown.length === 0 && <li className="tt-muted">{t("accounts.noMatch")}</li>}
              </ul>
            </>
          )}
        </section>
      </div>

      <OpenAccountDialog
        open={opening}
        onClose={() => setOpening(false)}
        onOpened={id => {
          reload();
          setShownId(id);
        }}
      />
      <AccountDialog
        account={current}
        onClose={() => setShownId(null)}
        currency={currency}
        timeZone={timeZone}
        canManage={canManage}
        onChanged={reload}
      />
    </div>
  );
}
