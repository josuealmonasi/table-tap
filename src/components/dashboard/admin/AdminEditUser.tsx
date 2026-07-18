"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useAdminActions } from "@/hooks/useAdminActions";
import { useT } from "@/lib/i18n/context";
import type { AdminUserRow } from "./AdminPanel";

interface AdminEditUserProps {
  user: AdminUserRow | null;
  onClose: () => void;
}

/** True when the role lives in a staff row and can be switched here. */
function roleEditable(role: AdminUserRow["role"]): boolean {
  return role === "owner" || role === "manager" || role === "waiter" || role === "kitchen";
}

/** Edit a login: name, email, an optional password reset, and (staff) role. */
export default function AdminEditUser({ user, onClose }: AdminEditUserProps) {
  const t = useT();
  const { busy, updateUser } = useAdminActions();
  const [name, setName] = useState(user?.full_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(user?.role ?? "kitchen");

  if (!user) return null;
  const canEditRole = roleEditable(user.role) && !user.founding;

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!user) return;
    const ok = await updateUser({
      userId: user.user_id,
      fullName: name.trim() !== (user.full_name ?? "") ? name : undefined,
      email: email.trim() !== user.email ? email.trim() : undefined,
      password: password || undefined,
      role: canEditRole && role !== user.role ? role : undefined,
    });
    if (ok) onClose();
  }

  return (
    <Modal open onClose={onClose} maxWidth={460}>
      <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 4 }}>
        {t("admin.editUserTitle", { email: user.email })}
      </h3>
      <p className="tt-muted" style={{ marginTop: 0, fontSize: 13 }}>
        {t("admin.keepPassword")}
      </p>

      <form className="tt-prodform" onSubmit={handleSubmit}>
        <label className="tt-field">
          <span className="tt-mod-label">{t("dash.fullName")}</span>
          <input
            className="tt-input"
            placeholder={t("admin.namePlaceholder")}
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </label>

        <label className="tt-field">
          <span className="tt-mod-label">{t("dash.email")}</span>
          <input
            className="tt-input"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
        </label>

        <div className="tt-prodform-row">
          <label className="tt-field" style={{ flex: 1 }}>
            <span className="tt-mod-label">{t("admin.resetPassword")}</span>
            <input
              className="tt-input"
              type="password"
              placeholder={t("dash.newPassword")}
              minLength={8}
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </label>

          <label className="tt-field" style={{ width: 150 }}>
            <span className="tt-mod-label">{t("dash.role")}</span>
            {canEditRole ? (
              <select
                className="tt-input"
                value={role}
                onChange={e => setRole(e.target.value as AdminUserRow["role"])}
              >
                <option value="kitchen">{t("dash.kitchen")}</option>
                <option value="waiter">{t("dash.waiter")}</option>
                <option value="manager">{t("dash.manager")}</option>
                <option value="owner">{t("dash.owner")}</option>
              </select>
            ) : (
              <input
                className="tt-input"
                value={user.founding ? t("admin.foundingOwner") : user.role}
                disabled
                title={t("admin.cantChangeRole")}
              />
            )}
          </label>
        </div>

        <div className="tt-prodform-actions">
          <button
            type="button"
            className="tt-btn tt-btn-ghost tt-btn-sm"
            onClick={onClose}
          >
            {t("common.cancel")}
          </button>
          <button type="submit" className="tt-btn tt-btn-primary tt-btn-sm" disabled={busy}>
            {busy ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
