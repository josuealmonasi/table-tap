"use client";

import { useState } from "react";
import { useProfile } from "@/hooks/useProfile";
import { useT } from "@/lib/i18n/context";
import Breadcrumb from "@/components/layout/Breadcrumb";

interface ProfileFormProps {
  userId: string;
  initialName: string;
  initialEmail: string;
}

/** The user's own profile: name, login email, and a password change. */
export default function ProfileForm({
  userId,
  initialName,
  initialEmail,
}: ProfileFormProps) {
  const t = useT();
  const { saving, saveName, saveEmail, savePassword } = useProfile(userId);
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [mismatch, setMismatch] = useState(false);

  async function handleDetails(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (name.trim() !== initialName) await saveName(name);
    if (email.trim() && email.trim() !== initialEmail) await saveEmail(email.trim());
  }

  async function handlePassword(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (password !== confirm) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    if (await savePassword(password)) {
      setPassword("");
      setConfirm("");
    }
  }

  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb
            trail={[
              { labelKey: "nav.dashboard", href: "/dashboard" },
              { labelKey: "nav.profile" },
            ]}
          />
        </header>

        <div className="tt-section" style={{ maxWidth: 520 }}>
          <div className="tt-section-head">
            <h3 className="tt-serif" style={{ margin: 0 }}>
              {t("dash.profileDetails")}
            </h3>
            <span className="tt-muted" style={{ fontSize: 12 }}>
              {t("dash.profileNameHint")}
            </span>
          </div>

          <form className="tt-prodform" onSubmit={handleDetails}>
            <label className="tt-field">
              <span className="tt-mod-label">{t("dash.fullName")}</span>
              <input
                className="tt-input"
                placeholder={t("dash.yourName")}
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
            <p className="tt-muted" style={{ fontSize: 12, margin: 0 }}>
              {t("dash.emailChangeHint")}
            </p>
            <div className="tt-prodform-actions">
              <button
                type="submit"
                className="tt-btn tt-btn-primary tt-btn-sm"
                disabled={saving || !email.trim()}
              >
                {saving ? t("common.saving") : t("dash.saveDetails")}
              </button>
            </div>
          </form>
        </div>

        <div className="tt-section" style={{ maxWidth: 520 }}>
          <div className="tt-section-head">
            <h3 className="tt-serif" style={{ margin: 0 }}>
              {t("dash.changePassword")}
            </h3>
          </div>

          <form className="tt-prodform" onSubmit={handlePassword}>
            <div className="tt-prodform-row">
              <input
                className="tt-input"
                style={{ flex: 1 }}
                type="password"
                placeholder={t("dash.newPassword")}
                minLength={8}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
              <input
                className="tt-input"
                style={{ flex: 1 }}
                type="password"
                placeholder={t("dash.repeatPassword")}
                minLength={8}
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
              />
            </div>
            {mismatch && (
              <p className="tt-accent" style={{ fontSize: 13, margin: 0 }}>
                {t("dash.passwordMismatch")}
              </p>
            )}
            <div className="tt-prodform-actions">
              <button
                type="submit"
                className="tt-btn tt-btn-primary tt-btn-sm"
                disabled={saving}
              >
                {saving ? t("common.saving") : t("dash.updatePassword")}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
