"use client";

import { useState } from "react";
import { useAdminActions, type NewUserInput } from "@/hooks/useAdminActions";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import AddInDialog from "@/components/ui/AddInDialog";

interface AdminCreateUserProps {
  restaurantOptions: { id: string; name: string }[];
}

const NEW_RESTAURANT = "__new__";

/** Create any kind of login: admin, founding owner, co-owner, manager, kitchen. */
export default function AdminCreateUser({ restaurantOptions }: AdminCreateUserProps) {
  const t = useT();
  const toast = useToast();
  const { busy, createUser } = useAdminActions();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<NewUserInput["role"]>("kitchen");
  const [restaurantId, setRestaurantId] = useState(restaurantOptions[0]?.id ?? "");
  const [restaurantName, setRestaurantName] = useState("");

  const needsRestaurant = role !== "admin";
  const creatingNew = role === "owner" && restaurantId === NEW_RESTAURANT;

  /** Returns whether the login was created, so a failure keeps the dialog open. */
  async function handleSubmit(e: React.FormEvent): Promise<boolean> {
    e.preventDefault();
    const ok = await createUser({
      email: email.trim(),
      password,
      role,
      restaurantId: needsRestaurant && !creatingNew ? restaurantId : undefined,
      restaurantName: creatingNew ? restaurantName.trim() : undefined,
    });
    if (!ok) return false;
    setEmail("");
    setPassword("");
    setRestaurantName("");
    toast(t("done.loginCreated"));
    return true;
  }

  return (
    <div className="tt-section" style={{ maxWidth: 560 }}>
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("admin.createUser")}
        </h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>
          {t("admin.createHint")}
        </span>
      </div>

      <AddInDialog
        label={t("admin.createLogin")}
        title={t("admin.createLogin")}
        maxWidth={560}
      >
        {close => (
          <form
            className="tt-prodform"
            onSubmit={async e => {
              if (await handleSubmit(e)) close();
            }}
          >
            <div className="tt-prodform-row">
              <input
                className="tt-input"
                style={{ flex: 1 }}
                type="email"
                placeholder={t("admin.emailPlaceholder")}
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
              <input
                className="tt-input"
                style={{ flex: 1 }}
                type="password"
                placeholder={t("admin.passwordPlaceholder")}
                minLength={8}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>

            <div className="tt-prodform-row">
              <label className="tt-field" style={{ flex: 1 }}>
                <span className="tt-mod-label">{t("dash.role")}</span>
                <select
                  className="tt-input"
                  value={role}
                  onChange={e => setRole(e.target.value as NewUserInput["role"])}
                >
                  <option value="kitchen">{t("dash.kitchen")}</option>
                  <option value="waiter">{t("dash.waiter")}</option>
                  <option value="cashier">{t("dash.cashier")}</option>
                  <option value="manager">{t("dash.manager")}</option>
                  <option value="owner">{t("dash.owner")}</option>
                  <option value="admin">{t("admin.platformAdmin")}</option>
                </select>
              </label>

              {needsRestaurant && (
                <label className="tt-field" style={{ flex: 1.4 }}>
                  <span className="tt-mod-label">{t("admin.restaurant")}</span>
                  <select
                    className="tt-input"
                    value={restaurantId}
                    onChange={e => setRestaurantId(e.target.value)}
                  >
                    {restaurantOptions.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                    {role === "owner" && (
                      <option value={NEW_RESTAURANT}>
                        {t("admin.newRestaurantOption")}
                      </option>
                    )}
                  </select>
                </label>
              )}
            </div>

            {creatingNew && (
              <input
                className="tt-input"
                placeholder={t("admin.newRestaurantName")}
                value={restaurantName}
                onChange={e => setRestaurantName(e.target.value)}
                required
              />
            )}

            <div className="tt-prodform-actions">
              <button
                type="submit"
                className="tt-btn tt-btn-primary tt-btn-sm"
                disabled={busy}
              >
                {busy ? t("common.working") : t("admin.createLogin")}
              </button>
            </div>
          </form>
        )}
      </AddInDialog>
    </div>
  );
}
