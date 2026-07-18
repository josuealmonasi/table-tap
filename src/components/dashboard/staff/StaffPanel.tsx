"use client";

import { useState } from "react";
import { useStaff, type StaffRole } from "@/hooks/useStaff";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useT } from "@/lib/i18n/context";
import Breadcrumb from "@/components/layout/Breadcrumb";

interface StaffPanelProps {
  restaurantId: string;
  /** Extra sections rendered below the team card (e.g. the activity log). */
  children?: React.ReactNode;
}

const ROLE_EMOJI: Record<StaffRole, string> = {
  owner: "👑",
  manager: "🧑‍💼",
  waiter: "🧑‍🍽️",
  kitchen: "👨‍🍳",
};

/** Owner-only team management: create, re-role and remove logins. */
export default function StaffPanel({ restaurantId, children }: StaffPanelProps) {
  const t = useT();
  const { members, loading, busy, addMember, updateRole, removeMember } =
    useStaff(restaurantId);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("kitchen");
  const confirm = useConfirm();

  async function handleAdd(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (await addMember(email.trim(), role)) {
      setEmail("");
      setRole("kitchen");
    }
  }

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[
              { labelKey: "nav.dashboard", href: "/dashboard" },
              { labelKey: "nav.staff" },
            ]}
          />
        </header>

        <div className="tt-section" style={{ maxWidth: 560 }}>
          <div className="tt-section-head">
            <h3 className="tt-serif" style={{ margin: 0 }}>
              {t("dash.teamLogins")}
            </h3>
            <span className="tt-muted" style={{ fontSize: 12 }}>
              {t("dash.teamHint")}
            </span>
          </div>

          {loading && (
            <p className="tt-muted" style={{ fontSize: 13 }}>
              {t("common.loading")}
            </p>
          )}
          {!loading && members.length === 0 && (
            <p className="tt-muted" style={{ fontSize: 13 }}>
              {t("dash.noStaff")}
            </p>
          )}
          {members.length > 0 && (
            <div className="tt-staff-table">
              <div className="tt-staff-tr tt-staff-thead" aria-hidden="true">
                <span>{t("dash.name")}</span>
                <span>{t("dash.email")}</span>
                <span>{t("dash.role")}</span>
                <span />
              </div>
              {members.map(m => (
                <div key={m.id} className="tt-staff-tr">
                  <span className="tt-staff-cell" title={m.full_name ?? ""}>
                    {ROLE_EMOJI[m.role]}{" "}
                    {m.full_name ? (
                      <strong>{m.full_name}</strong>
                    ) : (
                      <span className="tt-muted">—</span>
                    )}
                  </span>
                  <span className="tt-staff-cell tt-muted" title={m.email}>
                    {m.email}
                  </span>
                  <select
                    className="tt-input tt-role-select"
                    value={m.role}
                    disabled={busy}
                    aria-label={t("dash.roleFor", { email: m.email })}
                    onChange={e => updateRole(m.id, e.target.value as StaffRole)}
                  >
                    <option value="kitchen">{t("dash.kitchen")}</option>
                    <option value="waiter">{t("dash.waiter")}</option>
                    <option value="manager">{t("dash.manager")}</option>
                    <option value="owner">{t("dash.owner")}</option>
                  </select>
                  <button
                    className="tt-iconbtn"
                    title={t("dash.removeLogin")}
                    disabled={busy}
                    onClick={async () => {
                      if (
                        await confirm({
                          title: t("dash.removeConfirm", { name: m.full_name || m.email }),
                          message: t("dash.removeConfirmMsg"),
                          confirmLabel: t("common.remove"),
                          danger: true,
                        })
                      ) {
                        removeMember(m.id);
                      }
                    }}
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          )}

          <form className="tt-prodform" style={{ marginTop: 16 }} onSubmit={handleAdd}>
            <input
              className="tt-input"
              type="email"
              placeholder={t("dash.staffEmailPlaceholder")}
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
            <label className="tt-field" style={{ maxWidth: 220 }}>
              <span className="tt-mod-label">{t("dash.role")}</span>
              <select
                className="tt-input"
                value={role}
                onChange={e => setRole(e.target.value as StaffRole)}
              >
                <option value="kitchen">{t("dash.roleKitchen")}</option>
                <option value="waiter">{t("dash.roleWaiter")}</option>
                <option value="manager">{t("dash.roleManager")}</option>
                <option value="owner">{t("dash.roleOwner")}</option>
              </select>
            </label>
            <div className="tt-prodform-actions">
              <button
                type="submit"
                className="tt-btn tt-btn-primary tt-btn-sm"
                disabled={busy}
              >
                {busy ? t("dash.sending") : t("dash.sendInvite")}
              </button>
            </div>
          </form>
        </div>

        {children}
      </div>
    </div>
  );
}
