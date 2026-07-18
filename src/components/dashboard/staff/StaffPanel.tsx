"use client";

import { useState } from "react";
import { useStaff, type StaffRole } from "@/hooks/useStaff";
import { useConfirm } from "@/components/ui/ConfirmDialog";
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
            trail={[{ label: "Dashboard", href: "/dashboard" }, { label: "Staff" }]}
          />
        </header>

        <div className="tt-section" style={{ maxWidth: 560 }}>
          <div className="tt-section-head">
            <h3 className="tt-serif" style={{ margin: 0 }}>
              Team logins
            </h3>
            <span className="tt-muted" style={{ fontSize: 12 }}>
              Kitchen &amp; waiter: orders board only · Manager: + menus, tables,
              settings, refunds · Owner: everything (max 3)
            </span>
          </div>

          {loading && (
            <p className="tt-muted" style={{ fontSize: 13 }}>
              Loading…
            </p>
          )}
          {!loading && members.length === 0 && (
            <p className="tt-muted" style={{ fontSize: 13 }}>
              No staff yet. Invite your kitchen team below — they&apos;ll get an email
              to set their own password.
            </p>
          )}
          {members.length > 0 && (
            <div className="tt-staff-table">
              <div className="tt-staff-tr tt-staff-thead" aria-hidden="true">
                <span>Name</span>
                <span>Email</span>
                <span>Role</span>
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
                    aria-label={`Role for ${m.email}`}
                    onChange={e => updateRole(m.id, e.target.value as StaffRole)}
                  >
                    <option value="kitchen">Kitchen</option>
                    <option value="waiter">Waiter</option>
                    <option value="manager">Manager</option>
                    <option value="owner">Owner</option>
                  </select>
                  <button
                    className="tt-iconbtn"
                    title="Remove login"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        await confirm({
                          title: `Remove ${m.full_name || m.email}?`,
                          message: "Their login stops working immediately.",
                          confirmLabel: "Remove",
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
              placeholder="staff@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
            <label className="tt-field" style={{ maxWidth: 220 }}>
              <span className="tt-mod-label">Role</span>
              <select
                className="tt-input"
                value={role}
                onChange={e => setRole(e.target.value as StaffRole)}
              >
                <option value="kitchen">Kitchen — orders board only</option>
                <option value="waiter">Waiter — orders board &amp; floor service</option>
                <option value="manager">Manager — menus, tables, settings, refunds</option>
                <option value="owner">Owner — everything (max 3 owners)</option>
              </select>
            </label>
            <div className="tt-prodform-actions">
              <button
                type="submit"
                className="tt-btn tt-btn-primary tt-btn-sm"
                disabled={busy}
              >
                {busy ? "Sending…" : "✉️ Send invite"}
              </button>
            </div>
          </form>
        </div>

        {children}
      </div>
    </div>
  );
}
