"use client";

import { useState } from "react";
import { useAdminActions } from "@/hooks/useAdminActions";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import Breadcrumb from "@/components/layout/Breadcrumb";
import AdminCreateUser from "./AdminCreateUser";
import AdminEditUser from "./AdminEditUser";

export interface AdminRestaurantRow {
  id: string;
  name: string;
  owner_email: string;
  team_count: number;
  created_at: string;
}

export interface AdminUserRow {
  user_id: string;
  email: string;
  full_name?: string;
  role: "admin" | "owner" | "manager" | "kitchen" | "none";
  /** Founding owners' role is fixed (it comes from restaurants.owner_id). */
  founding?: boolean;
  restaurant_name?: string;
}

interface AdminPanelProps {
  adminUserId: string;
  restaurants: AdminRestaurantRow[];
  users: AdminUserRow[];
  restaurantOptions: { id: string; name: string }[];
}

const ROLE_LABEL: Record<AdminUserRow["role"], string> = {
  admin: "🛡️ Admin",
  owner: "👑 Owner",
  manager: "🧑‍💼 Manager",
  kitchen: "👨‍🍳 Kitchen",
  none: "—",
};

/** The platform admin's home: every restaurant and login, with full control. */
export default function AdminPanel({
  adminUserId,
  restaurants,
  users,
  restaurantOptions,
}: AdminPanelProps) {
  const { busy, deleteUser, deleteRestaurant } = useAdminActions();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<AdminUserRow | null>(null);

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb trail={[{ label: "Platform Admin" }]} />
        </header>

        <div className="tt-section">
          <div className="tt-section-head">
            <h3 className="tt-serif" style={{ margin: 0 }}>
              Restaurants
            </h3>
            <span className="tt-muted" style={{ fontSize: 12 }}>
              {restaurants.length} total
            </span>
          </div>
          <div className="tt-admin-table">
            <div
              className="tt-admin-tr tt-staff-thead"
              style={{
                gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1.4fr) 70px 100px 32px",
              }}
              aria-hidden="true"
            >
              <span>Restaurant</span>
              <span>Founding owner</span>
              <span>Team</span>
              <span>Created</span>
              <span />
            </div>
            {restaurants.map(r => (
              <div
                key={r.id}
                className="tt-admin-tr"
                style={{
                  gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1.4fr) 70px 100px 32px",
                }}
              >
                <span className="tt-staff-cell" title={r.name}>
                  <strong>{r.name}</strong>
                </span>
                <span className="tt-staff-cell tt-muted" title={r.owner_email}>
                  {r.owner_email}
                </span>
                <span>{r.team_count}</span>
                <span className="tt-muted" style={{ fontSize: 12 }}>
                  {new Date(r.created_at).toLocaleDateString([], {
                    day: "2-digit",
                    month: "short",
                  })}
                </span>
                <button
                  className="tt-iconbtn"
                  title="Delete restaurant"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: `Delete ${r.name}?`,
                        message:
                          "Menus, orders, tables and team logins are erased permanently.",
                        confirmLabel: "Delete restaurant",
                        danger: true,
                      })
                    ) {
                      deleteRestaurant(r.id);
                    }
                  }}
                >
                  🗑️
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="tt-section" style={{ marginTop: 16 }}>
          <div className="tt-section-head">
            <h3 className="tt-serif" style={{ margin: 0 }}>
              Users
            </h3>
            <span className="tt-muted" style={{ fontSize: 12 }}>
              {users.length} total
            </span>
          </div>
          <div className="tt-admin-table">
            <div className="tt-admin-tr tt-staff-thead" aria-hidden="true">
              <span>Email</span>
              <span>Name</span>
              <span>Role</span>
              <span>Restaurant</span>
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
                <span style={{ whiteSpace: "nowrap", fontSize: 13 }}>
                  {ROLE_LABEL[u.role]}
                </span>
                <span className="tt-staff-cell tt-muted" title={u.restaurant_name ?? ""}>
                  {u.restaurant_name ?? "—"}
                </span>
                {u.user_id === adminUserId ? (
                  <span className="tt-muted" style={{ fontSize: 11 }}>
                    you
                  </span>
                ) : (
                  <span style={{ display: "flex", gap: 2 }}>
                    <button
                      className="tt-iconbtn"
                      title="Edit login"
                      disabled={busy}
                      onClick={() => setEditing(u)}
                    >
                      ✏️
                    </button>
                    <button
                      className="tt-iconbtn"
                      title="Delete login"
                      disabled={busy}
                      onClick={async () => {
                        if (
                          await confirm({
                            title: `Delete ${u.email}?`,
                            message: "Their login stops working immediately.",
                            confirmLabel: "Delete login",
                            danger: true,
                          })
                        ) {
                          deleteUser(u.user_id);
                        }
                      }}
                    >
                      🗑️
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
