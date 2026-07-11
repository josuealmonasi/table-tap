"use client";

import { useState } from "react";
import { useStaff, type StaffRole } from "@/hooks/useStaff";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import Breadcrumb from "@/components/layout/Breadcrumb";

interface StaffPanelProps {
  restaurantId: string;
}

/** Owner-only staff management: create and remove orders-board logins. */
export default function StaffPanel({ restaurantId }: StaffPanelProps) {
  const { members, loading, busy, addMember, removeMember } = useStaff(restaurantId);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<StaffRole>("kitchen");
  const confirm = useConfirm();

  async function handleAdd(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (await addMember(email.trim(), password, role)) {
      setEmail("");
      setPassword("");
      setRole("kitchen");
    }
  }

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb trail={[{ label: "Dashboard", href: "/dashboard" }, { label: "Staff" }]} />
        </header>

        <div className="tt-section" style={{ maxWidth: 560 }}>
          <div className="tt-section-head">
            <h3 className="tt-serif" style={{ margin: 0 }}>Staff logins</h3>
            <span className="tt-muted" style={{ fontSize: 12 }}>
              Kitchen sees the orders board only; managers also run menus, tables and refunds
            </span>
          </div>

          {loading && <p className="tt-muted" style={{ fontSize: 13 }}>Loading…</p>}
          {!loading && members.length === 0 && (
            <p className="tt-muted" style={{ fontSize: 13 }}>
              No staff yet. Create a login for the kitchen below.
            </p>
          )}
          {members.map((m) => (
            <div key={m.id} className="tt-staff-row">
              <span>
                {m.role === "manager" ? "🧑‍💼" : "👨‍🍳"} <strong>{m.full_name ?? m.email}</strong>
                {m.full_name && (
                  <span className="tt-muted" style={{ fontSize: 12 }}> · {m.email}</span>
                )}{" "}
                <span className="tt-badge">{m.role === "manager" ? "Manager" : "Kitchen"}</span>
              </span>
              <button
                className="tt-iconbtn"
                title="Remove login"
                disabled={busy}
                onClick={async () => {
                  if (
                    await confirm({
                      title: `Remove ${m.email}?`,
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

          <form className="tt-prodform" style={{ marginTop: 16 }} onSubmit={handleAdd}>
            <div className="tt-prodform-row">
              <input
                className="tt-input"
                style={{ flex: 1 }}
                type="email"
                placeholder="staff@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <input
                className="tt-input"
                style={{ flex: 1 }}
                type="password"
                placeholder="Password (8+ characters)"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <label className="tt-field" style={{ maxWidth: 220 }}>
              <span className="tt-mod-label">Role</span>
              <select className="tt-input" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
                <option value="kitchen">Kitchen — orders board only</option>
                <option value="manager">Manager — menus, tables, refunds</option>
              </select>
            </label>
            <div className="tt-prodform-actions">
              <button type="submit" className="tt-btn tt-btn-primary tt-btn-sm" disabled={busy}>
                {busy ? "Working…" : "+ Add staff login"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
