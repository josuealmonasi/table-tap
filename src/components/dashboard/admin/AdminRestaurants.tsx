"use client";

import Link from "next/link";
import { useState } from "react";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateLocale } from "@/lib/format";
import { planLabel } from "@/lib/plan";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { DeleteIcon, ResumeIcon, ScheduleIcon, SuspendIcon } from "@/components/ui/icons";
import type { AdminRestaurantRow } from "./AdminPanel";
import BillingLine from "./AdminBillingLine";
import AdminUsageDialog from "./AdminUsageDialog";
import AdminTierDialog, { type TierAssignment } from "./AdminTierDialog";
import AdminSuspendDialog, { type SuspendReason } from "./AdminSuspendDialog";
import AdminTrialDialog from "./AdminTrialDialog";

interface AdminRestaurantsProps {
  restaurants: AdminRestaurantRow[];
  /** Every plan in the catalog, cheapest first. */
  plans: string[];
  busy: boolean;
  /** Resolves true when the move was made. */
  onMovePlan: (id: string, plan: string, doneMsg: string, choice: TierAssignment) => Promise<boolean>;
  onDelete: (id: string) => void;
  onSuspend: (id: string, reason: SuspendReason, doneMsg: string) => Promise<boolean>;
  onLift: (id: string, doneMsg: string) => Promise<boolean>;
  onTrial: (id: string, endsAt: string | null, doneMsg: string) => Promise<boolean>;
}

/**
 * Every restaurant, with its plan and the way to change it.
 *
 * Moving a restaurant moves its whole team: a plan belongs to the restaurant,
 * not to any one login. Asked first, because what the team can use changes the
 * moment it is confirmed.
 */
export default function AdminRestaurants({ restaurants, plans, busy, onMovePlan, onDelete, onSuspend, onLift, onTrial }: AdminRestaurantsProps) {
  const t = useT();
  const { locale } = useLocale();
  const confirm = useConfirm();
  // The plan chosen, shown at once rather than after the page reloads — and
  // put back if the move was refused.
  const [shown, setShown] = useState<Record<string, string>>({});

  // The row whose trial the admin is changing.
  const [trialRow, setTrialRow] = useState<AdminRestaurantRow | null>(null);

  async function changeTrial(endsAt: string | null): Promise<void> {
    if (!trialRow) return;
    const r = trialRow;
    setTrialRow(null);
    await onTrial(r.id, endsAt, t(endsAt ? "adminTrial.extended" : "adminTrial.ended", { name: r.name }));
  }

  // The row whose suspension the admin is changing.
  const [suspending, setSuspending] = useState<AdminRestaurantRow | null>(null);

  async function changeSuspension(reason: SuspendReason | null): Promise<void> {
    if (!suspending) return;
    const r = suspending;
    setSuspending(null);
    if (reason) await onSuspend(r.id, reason, t("adminSuspend.done", { name: r.name }));
    else await onLift(r.id, t("adminSuspend.lifted", { name: r.name }));
  }

  // The tier picked in a row, waiting for the admin to say how it is paid.
  const [usage, setUsage] = useState<AdminRestaurantRow | null>(null);
  const [picking, setPicking] = useState<{ row: AdminRestaurantRow; plan: string } | null>(null);

  function pick(r: AdminRestaurantRow, plan: string): void {
    if (plan === (shown[r.id] ?? r.plan)) return;
    setPicking({ row: r, plan });
  }

  async function assign(choice: TierAssignment): Promise<void> {
    if (!picking) return;
    const { row: r, plan } = picking;
    setPicking(null);
    setShown(s => ({ ...s, [r.id]: plan }));
    const done = choice.billing === "payment_link" ? "admin.tierLinkSent" : choice.billing === "next_bill" ? "admin.tierNextBillDone"
      : choice.billing === "test" ? "admin.tierTestDone" : "admin.planMoved";
    const moved = await onMovePlan(r.id, plan, t(done, { name: r.name, plan: planLabel(plan) }), choice);
    if (!moved) setShown(s => ({ ...s, [r.id]: r.plan }));
  }

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("admin.restaurants")}
        </h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>
          {t("admin.total", { n: restaurants.length })}
        </span>
      </div>
      <div className="tt-admin-table">
        <div className="tt-admin-tr tt-admin-tr--rest tt-staff-thead" aria-hidden="true">
          <span>{t("admin.restaurant")}</span>
          <span>{t("admin.foundingOwner")}</span>
          <span>{t("admin.plan")}</span>
          <span>{t("admin.team")}</span>
          <span>{t("admin.created")}</span>
          <span />
        </div>
        {restaurants.map(r => (
          <div key={r.id} className="tt-admin-tr tt-admin-tr--rest">
            <span className="tt-staff-cell" title={r.name}>
              <strong>{r.name}</strong>
              <BillingLine billing={r.billing} />
              <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" onClick={() => setUsage(r)}>{t("admin.usage")}</button>
              <Link className="tt-btn tt-btn-ghost tt-btn-sm" href={`/dashboard/admin/restaurants/${r.id}`}>{t("adminView.open")}</Link>
            </span>
            <span className="tt-staff-cell tt-muted" title={r.owner_email}>
              {r.owner_email}
            </span>
            <select
              className="tt-input tt-admin-plan"
              aria-label={t("admin.plan")}
              value={shown[r.id] ?? r.plan}
              disabled={busy}
              onChange={e => pick(r, e.target.value)}
            >
              {plans.map(p => (
                <option key={p} value={p}>
                  {planLabel(p)}
                </option>
              ))}
            </select>
            <span>{r.team_count}</span>
            <span className="tt-muted" style={{ fontSize: 12 }}>
              {new Date(r.created_at).toLocaleDateString(dateLocale(locale), {
                day: "2-digit",
                month: "short",
              })}
            </span>
            <span className="tt-admin-row-actions">
            {r.billing.plan_status === "trialing" && !r.billing.stripe_subscription_id && (
              <button type="button" className="tt-iconbtn" title={t("adminTrial.button")} aria-label={t("adminTrial.button")}
                disabled={busy} onClick={() => setTrialRow(r)}>
                <ScheduleIcon size={16} />
              </button>
            )}
            <button
              type="button"
              className="tt-iconbtn"
              title={r.billing.suspended_at ? t("adminSuspend.lift") : t("adminSuspend.suspend")}
              aria-label={r.billing.suspended_at ? t("adminSuspend.lift") : t("adminSuspend.suspend")}
              disabled={busy}
              onClick={() => setSuspending(r)}
            >
              {r.billing.suspended_at ? <ResumeIcon size={16} /> : <SuspendIcon size={16} />}
            </button>
            <button
              className="tt-iconbtn"
              title={t("admin.deleteRestaurant")}
              disabled={busy}
              onClick={async () => {
                if (
                  await confirm({
                    title: t("admin.deleteRestaurantConfirm", { name: r.name }),
                    message: t("admin.deleteRestaurantMsg"),
                    confirmLabel: t("admin.deleteRestaurant"),
                    danger: true,
                  })
                ) {
                  onDelete(r.id);
                }
              }}
            >
              <DeleteIcon size={16} />
            </button>
            </span>
          </div>
        ))}
      </div>
      {usage ? <AdminUsageDialog id={usage.id} name={usage.name} onClose={() => setUsage(null)} /> : null}
      {trialRow ? (
        <AdminTrialDialog
          name={trialRow.name}
          endsAt={trialRow.billing.trial_ends_at}
          busy={busy}
          onClose={() => setTrialRow(null)}
          onConfirm={endsAt => void changeTrial(endsAt)}
        />
      ) : null}
      {suspending ? (
        <AdminSuspendDialog
          name={suspending.name}
          suspended={Boolean(suspending.billing.suspended_at)}
          busy={busy}
          onClose={() => setSuspending(null)}
          onConfirm={reason => void changeSuspension(reason)}
        />
      ) : null}
      {picking ? (
        <AdminTierDialog
          name={picking.row.name}
          plan={picking.plan}
          billedByStripe={picking.row.billed_by_stripe}
          busy={busy}
          onClose={() => setPicking(null)}
          onAssign={choice => void assign(choice)}
        />
      ) : null}
    </div>
  );
}
