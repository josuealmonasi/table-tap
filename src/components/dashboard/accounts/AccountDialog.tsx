"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { formatMoney } from "@/lib/format";
import { accountLink, formatCode } from "@/lib/accounts";
import { qrSvg } from "@/lib/qr";
import type { StatementDay } from "@/lib/accounts";
import type { AccountListItem } from "@/hooks/useOpenAccounts";
import StatementDays from "@/components/accounts/StatementDays";
import SettleAccountDialog from "./SettleAccountDialog";

interface AccountDialogProps {
  account: AccountListItem | null;
  onClose: () => void;
  currency: string;
  timeZone: string;
  /** Managers and owners move a ceiling; everyone who takes money does the rest. */
  canManage: boolean;
  onChanged: () => void;
}

interface StaffStatement {
  owed: number;
  days: StatementDay[];
  chargedBy: Record<string, string | null>;
}

/**
 * One account: what it owes and for what, its QR for the customer to check it
 * on their phone, and what the staff can do to it — collect it, move its
 * ceiling, give it a new code, close it once it owes nothing.
 */
export default function AccountDialog({ account, onClose, currency, timeZone, canManage, onChanged }: AccountDialogProps) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const [statement, setStatement] = useState<StaffStatement | null>(null);
  const [failed, setFailed] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [limit, setLimit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const link = account && typeof window !== "undefined" ? accountLink(window.location.origin, account.code) : "";

  useEffect(() => {
    if (!account) return;
    let live = true;
    setStatement(null);
    setFailed(false);
    setLimit(String(account.credit_limit));
    fetch(`/api/accounts?id=${account.id}`)
      .then(async r => {
        if (!r.ok) throw new Error(String(r.status));
        const d = await r.json();
        if (live) setStatement(d.statement);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [account, attempt]);

  useEffect(() => {
    if (!link) return;
    let live = true;
    void qrSvg(link).then(s => live && setSvg(s));
    return () => {
      live = false;
    };
  }, [link]);

  if (!account) return null;
  const money = (n: number) => formatMoney(n, currency);
  const owed = statement?.owed ?? account.owed;

  async function change(body: Record<string, unknown>, done: string): Promise<void> {
    setError(null);
    try {
      const res = await fetch("/api/accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: account!.id, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? t("apiErr.generic"));
        return;
      }
      toast(done);
      onChanged();
    } catch {
      setError(t("done.networkError"));
    }
  }

  return (
    <>
      <Modal open onClose={onClose} maxWidth={560} title={account.name}>
        <p className="tt-account-owed">
          {t("accounts.owesOf", { owed: money(owed), limit: money(Number(account.credit_limit)) })}
        </p>
        {account.email && <p className="tt-muted" style={{ marginTop: 0 }}>{account.email}</p>}

        {failed ? (
          <p className="tt-field-error" role="alert">
            {t("accounts.statementFailed")}{" "}
            <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => setAttempt(n => n + 1)}>
              {t("fallback.retry")}
            </button>
          </p>
        ) : !statement ? (
          <p className="tt-muted">{t("common.loading")}</p>
        ) : (
          <StatementDays
            days={statement.days.map(d => ({
              ...d,
              charges: d.charges.map(c => ({ ...c, chargedBy: statement.chargedBy[c.orderId] ?? null })),
            }))}
            currency={currency}
            timeZone={timeZone}
          />
        )}

        <div className="tt-bill-actions">
          {account.status === "open" && owed > 0 && (
            <button type="button" className="tt-btn tt-btn-primary tt-btn-lg" style={{ width: "100%" }} onClick={() => setCollecting(true)}>
              {t("accounts.settleOpen", { amount: money(owed) })}
            </button>
          )}
        </div>

        <section className="tt-account-qr">
          {svg ? (
            // Generated here from the account's own link: nothing from outside is drawn.
            <div className="tt-account-qr-img" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className="tt-account-qr-img" aria-hidden="true" />
          )}
          <div>
            <p className="tt-card-code">{formatCode(account.code)}</p>
            <p className="tt-muted" style={{ fontSize: 13 }}>{t("accounts.qrHint")}</p>
            <a className="tt-btn tt-btn-ghost tt-btn-sm" href={`/cuenta/${account.code}`} target="_blank" rel="noopener">
              {t("accounts.openStatement")}
            </a>
          </div>
        </section>

        {error && <p className="tt-field-error" role="alert">{error}</p>}

        {canManage && account.status === "open" && (
          <form
            className="tt-account-limit"
            onSubmit={e => {
              e.preventDefault();
              void change({ action: "limit", limit: Number(limit) }, t("accounts.limitChanged"));
            }}
          >
            <label className="tt-mod-label" htmlFor="account-limit">{t("accounts.limit")}</label>
            <div className="tt-row" style={{ gap: 8 }}>
              <input id="account-limit" className="tt-input" inputMode="decimal" value={limit} onChange={e => setLimit(e.target.value)} />
              <button type="submit" className="tt-btn tt-btn-ghost tt-btn-sm">{t("accounts.limitSave")}</button>
            </div>
          </form>
        )}

        {account.status === "open" && (
          <div className="tt-account-more">
            <button
              type="button"
              className="tt-btn tt-btn-ghost tt-btn-sm"
              onClick={async () => {
                const ok = await confirm({
                  title: t("accounts.newCodeTitle"),
                  message: t("accounts.newCodeBody"),
                  confirmLabel: t("accounts.newCode"),
                });
                if (ok) await change({ action: "code" }, t("accounts.newCodeDone"));
              }}
            >
              {t("accounts.newCode")}
            </button>
            {owed === 0 && (
              <button
                type="button"
                className="tt-btn tt-btn-ghost tt-btn-sm tt-danger-text"
                onClick={async () => {
                  const ok = await confirm({
                    title: t("accounts.closeTitle", { name: account.name }),
                    message: t("accounts.closeBody"),
                    confirmLabel: t("accounts.close"),
                    danger: true,
                  });
                  if (ok) await change({ action: "close" }, t("accounts.closed"));
                }}
              >
                {t("accounts.close")}
              </button>
            )}
          </div>
        )}
      </Modal>
      <SettleAccountDialog
        open={collecting}
        onClose={() => setCollecting(false)}
        accountId={account.id}
        name={account.name}
        owed={owed}
        currency={currency}
        onSettled={() => {
          setAttempt(n => n + 1);
          onChanged();
        }}
      />
    </>
  );
}
