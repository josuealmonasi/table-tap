"use client";

import { useState } from "react";
import { useAdminActions } from "@/hooks/useAdminActions";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useT } from "@/lib/i18n/context";
import Breadcrumb from "@/components/layout/Breadcrumb";
import AdminCreateUser from "./AdminCreateUser";
import AdminEditUser from "./AdminEditUser";
import AdminRestaurants from "./AdminRestaurants";
import { planLabel } from "@/lib/plan";
import { DeleteIcon, EditIcon } from "@/components/ui/icons";

export interface AdminRestaurantRow {
  id: string;
  name: string;
  owner_email: string;
  team_count: number;
  created_at: string;
  /** The restaurant's plan, which every login there works under. */
  plan: string;
  billed_by_stripe: boolean;
}

export interface AdminUserRow {
  user_id: string;
  email: string;
  full_name?: string;
  role: "admin" | "owner" | "manager" | "waiter" | "cashier" | "kitchen" | "none";
  /** Founding owners' role is fixed (it comes from restaurants.owner_id). */
  founding?: boolean;
  restaurant_name?: string;
  /** Their restaurant's plan: a login moves when its restaurant does. */
  plan?: string;
}

interface AdminPanelProps {
  adminUserId: string;
  restaurants: AdminRestaurantRow[];
  users: AdminUserRow[];
  restaurantOptions: { id: string; name: string }[];
  /** Every plan in the catalog, cheapest first. */
  plans: string[];
}

const ROLE_META: Record<AdminUserRow["role"], { key: string }> = {
  admin: { key: "admin.platformAdmin" },
  owner: { key: "dash.owner" },
  manager: { key: "dash.manager" },
  waiter: { key: "dash.waiter" },
  cashier: { key: "dash.cashier" },
  kitchen: { key: "dash.kitchen" },
  none: { key: "" },
};

/** The platform admin's home: every restaurant and login, with full control. */
export default function AdminPanel({
  adminUserId,
  restaurants,
  users,
  restaurantOptions,
  plans,
}: AdminPanelProps) {
  const t = useT();
  const { busy, deleteUser, deleteRestaurant, movePlan } = useAdminActions();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  const roleLabel = (role: AdminUserRow["role"]): string => {
    const m = ROLE_META[role];
    return m.key ? t(m.key) : "—";
  };

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb trail={[{ labelKey: "admin.title" }]} />
        </header>

        <AdminRestaurants
          restaurants={restaurants}
          plans={plans}
          busy={busy}
          onMovePlan={movePlan}
          onDelete={deleteRestaurant}
        />

        <div className="tt-section">
          <div className="tt-section-head">
            <h3 className="tt-serif" style={{ margin: 0 }}>
              {t("admin.users")}
            </h3>
            <span className="tt-muted" style={{ fontSize: 12 }}>
              {t("admin.total", { n: users.length })}
            </span>
          </div>
          <div className="tt-admin-table">
            <div className="tt-admin-tr tt-staff-thead" aria-hidden="true">
              <span>{t("dash.email")}</span>
              <span>{t("dash.name")}</span>
              <span>{t("dash.role")}</span>
              <span>{t("admin.restaurant")}</span>
              <span />
            </div>
            {users.map(u => (
              <div key={u.user_id} className="tt-admin-tr">
                <span className="tt-staff-cell" title={u.email}>
                  <strong>{u.email}</strong>
                </span>
                <span className="tt-staff-cell tt-muted" title={u.full_name ?? ""}>
                  {u.full_name ?? "—"}
                </span>
                <span className="tt-admin-role">{roleLabel(u.role)}</span>
                <span className="tt-staff-cell tt-muted" title={u.restaurant_name ?? ""}>
                  {u.restaurant_name ?? "—"}
                  {u.plan && <> · {planLabel(u.plan)}</>}
                </span>
                {u.user_id === adminUserId ? (
                  <span className="tt-muted" style={{ fontSize: 11 }}>
                    {t("admin.you")}
                  </span>
                ) : (
                  <span style={{ display: "flex", gap: 2 }}>
                    <button
                      className="tt-iconbtn"
                      title={t("admin.editLogin")}
                      disabled={busy}
                      onClick={() => setEditing(u)}
                    >
                      <EditIcon size={16} />
                    </button>
                    <button
                      className="tt-iconbtn"
                      title={t("admin.deleteLogin")}
                      disabled={busy}
                      onClick={async () => {
                        if (
                          await confirm({
                            title: t("admin.deleteLoginConfirm", { email: u.email }),
                            message: t("admin.deleteLoginMsg"),
                            confirmLabel: t("admin.deleteLogin"),
                            danger: true,
                          })
                        ) {
                          deleteUser(u.user_id);
                        }
                      }}
                    >
                      <DeleteIcon size={16} />
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        <AdminCreateUser restaurantOptions={restaurantOptions} />

        {editing && (
          <AdminEditUser
            key={editing.user_id}
            user={editing}
            onClose={() => setEditing(null)}
          />
        )}
      </div>
    </div>
  );
}
