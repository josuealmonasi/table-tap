"use client";

import { useState } from "react";
import { useStaff, type StaffRole } from "@/hooks/useStaff";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import Breadcrumb from "@/components/layout/Breadcrumb";
import {
  DeleteIcon,
  InviteIcon,
  RoleKitchenIcon,
  RoleManagerIcon,
  RoleOwnerIcon,
  RoleWaiterIcon,
  RoleCashierIcon,
} from "@/components/ui/icons";
import { StaffTableSkeleton } from "@/components/ui/DashSkeletons";
import { useRowMemory } from "@/hooks/useRowMemory";
import AddInDialog from "@/components/ui/AddInDialog";

interface StaffPanelProps {
  restaurantId: string;
  /** Extra sections rendered below the team card (e.g. the activity log). */
  children?: React.ReactNode;
  /** The roles this tier can hand out (`assignableRoles`). */
  roles?: StaffRole[];
}

/** Every role, in the order the screen lists them. */
const ALL_ROLES: StaffRole[] = ["kitchen", "waiter", "cashier", "manager", "owner"];
/** The invite form's longer label for each role. */
const ROLE_LABEL: Record<StaffRole, string> = {
  kitchen: "dash.roleKitchen",
  waiter: "dash.roleWaiter",
  cashier: "dash.roleCashier",
  manager: "dash.roleManager",
  owner: "dash.roleOwner",
};

const ROLE_ICON = {
  owner: RoleOwnerIcon,
  manager: RoleManagerIcon,
  waiter: RoleWaiterIcon,
  cashier: RoleCashierIcon,
  kitchen: RoleKitchenIcon,
} satisfies Record<StaffRole, typeof RoleOwnerIcon>;

/** Owner-only team management: create, re-role and remove logins. */
export default function StaffPanel({ restaurantId, children, roles = [...ALL_ROLES] }: StaffPanelProps) {
  const t = useT();
  const toast = useToast();
  const { members, loading, busy, addMember, updateRole, removeMember } =
    useStaff(restaurantId);
  const staffRows = useRowMemory("staff", 3, loading ? undefined : members.length);
  const [email, setEmail] = useState("");
  // The first role on offer: a cook where there is a kitchen board, a cashier on Caja.
  const firstRole = roles[0] ?? "cashier";
  const [role, setRole] = useState<StaffRole>(firstRole);
  const confirm = useConfirm();

  /** Returns whether the invite landed, so a failure keeps the dialog open. */
  async function handleAdd(e: React.FormEvent): Promise<boolean> {
    e.preventDefault();
    if (!(await addMember(email.trim(), role))) return false;
    setEmail("");
    setRole(firstRole);
    toast(t("done.inviteSent"));
    return true;
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

        {/* Team logins and the activity log sit side by side on desktop. */}
        <div className="tt-cols">
          <div className="tt-section">
            <div className="tt-section-head">
              <h3 className="tt-serif" style={{ margin: 0 }}>
                {t("dash.teamLogins")}
              </h3>
              <span className="tt-muted" style={{ fontSize: 12 }}>
                {t("dash.teamHint")}
              </span>
            </div>

            {loading && <StaffTableSkeleton rows={staffRows} />}
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
                      {(() => {
                        const RoleGlyph = ROLE_ICON[m.role];
                        return <RoleGlyph size={14} weight="bold" />;
                      })()}{" "}
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
                      {/* A member already in a role this tier no longer offers keeps
                          it shown, so the select never claims a role they lack. */}
                      {ALL_ROLES.filter(r => roles.includes(r) || r === m.role).map(r => (
                        <option key={r} value={r}>{t(`dash.${r}`)}</option>
                      ))}
                    </select>
                    <button
                      className="tt-iconbtn"
                      title={t("dash.removeLogin")}
                      disabled={busy}
                      onClick={async () => {
                        if (
                          await confirm({
                            title: t("dash.removeConfirm", {
                              name: m.full_name || m.email,
                            }),
                            message: t("dash.removeConfirmMsg"),
                            confirmLabel: t("common.remove"),
                            danger: true,
                          })
                        ) {
                          removeMember(m.id);
                        }
                      }}
                    >
                      <DeleteIcon size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <AddInDialog
              label={t("dash.sendInvite")}
              title={t("dash.sendInvite")}
              maxWidth={520}
            >
              {close => (
                <form
                  className="tt-prodform"
                  // Only close on success — closing on failure would throw
                  // away what they typed along with the error.
                  onSubmit={async e => {
                    if (await handleAdd(e)) close();
                  }}
                >
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
                      {roles.map(r => (
                        <option key={r} value={r}>{t(ROLE_LABEL[r])}</option>
                      ))}
                    </select>
                  </label>
                  <div className="tt-prodform-actions">
                    <button
                      type="submit"
                      className="tt-btn tt-btn-primary tt-btn-sm"
                      disabled={busy}
                    >
                      {busy ? (
                        t("dash.sending")
                      ) : (
                        <>
                          <InviteIcon size={15} weight="bold" /> {t("dash.sendInvite")}
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </AddInDialog>
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}
