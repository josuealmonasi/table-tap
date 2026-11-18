"use client";

import Breadcrumb from "@/components/layout/Breadcrumb";
import { dateLocale, formatMoney } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/context";
import { statusMeta } from "@/lib/order-status";
import { SEP } from "@/lib/separator";
import type { OwnerView } from "@/lib/admin-owner-view";

interface Props { view: OwnerView }

const ROLE_KEYS: Record<string, string> = {
  manager: "dash.manager", waiter: "dash.waiter", cashier: "dash.cashier", kitchen: "dash.kitchen",
};

/** A restaurant as its owner sees it, for the platform team. Nothing here writes. */
export default function AdminOwnerView({ view }: Props) {
  const t = useT();
  const { locale } = useLocale();
  const { restaurant: r } = view;
  const when = (iso: string) => new Date(iso).toLocaleString(dateLocale(locale), { timeZone: "America/Mexico_City" });
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb trail={[{ labelKey: "admin.title", href: "/dashboard/admin" }, { label: r.name }]} />
        </header>
        <p className="tt-admin-view-note" role="note">{t("adminView.readOnly")}</p>

        <section className="tt-section">
          <h3 className="tt-serif" style={{ margin: 0 }}>{r.name}</h3>
          <ul className="tt-admin-view-facts">
            <li>{t("adminView.plan")}: <strong>{r.plan}</strong>{r.plan_status ? SEP + r.plan_status : ""}</li>
            <li>{t("adminView.orders")}: <strong>{r.accepting_orders ? t("adminView.open_") : t("adminView.paused")}</strong></li>
            <li>{t("adminView.cards")}: <strong>{r.charges_enabled ? t("adminView.yes") : t("adminView.no")}</strong></li>
            {r.suspended_at ? <li><strong>{t("adminView.suspended", { date: when(r.suspended_at) })}</strong></li> : null}
          </ul>
        </section>

        <section className="tt-section">
          <h4 style={{ margin: 0 }}>{t("setup.title")}</h4>
          <ul className="tt-admin-view-list">
            {view.setup.map(s => (
              <li key={s.key}>
                <span>{t(`setup.${s.key}`)}{s.optional ? ` (${t("setup.optional")})` : ""}</span>
                <span className="tt-muted">{s.done ? t("setup.done") : t("adminView.pending")}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="tt-section">
          <h4 style={{ margin: 0 }}>{t("adminView.menus", { tables: view.tables })}</h4>
          <ul className="tt-admin-view-list">
            {view.menus.length ? view.menus.map(m => (
              <li key={m.id}>
                <span>{m.name}{m.active ? "" : ` (${t("adminView.inactive")})`}</span>
                <span className="tt-muted">{t("adminView.dishes", { n: m.dishes })}</span>
              </li>
            )) : <li className="tt-muted">{t("adminView.none")}</li>}
          </ul>
        </section>

        <section className="tt-section">
          <h4 style={{ margin: 0 }}>{t("adminView.team")}</h4>
          <ul className="tt-admin-view-list">
            {view.team.length ? view.team.map(m => (
              <li key={m.email}>
                <span className="tt-admin-view-wrap">{m.email}</span>
                <span className="tt-muted">{ROLE_KEYS[m.role] ? t(ROLE_KEYS[m.role]) : m.role}</span>
              </li>
            )) : <li className="tt-muted">{t("adminView.none")}</li>}
          </ul>
        </section>

        <section className="tt-section">
          <h4 style={{ margin: 0 }}>{t("adminView.recent")}</h4>
          <ul className="tt-admin-view-list">
            {view.orders.length ? view.orders.map(o => (
              <li key={o.id}>
                <span>{o.table_label ?? "—"}{SEP}{t(statusMeta(o.status).labelKey)}</span>
                <span className="tt-muted">
                  {formatMoney(o.total, r.currency)}{o.paid ? SEP + t("adminView.paid") : ""}{SEP}{when(o.created_at)}
                </span>
              </li>
            )) : <li className="tt-muted">{t("adminView.none")}</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
