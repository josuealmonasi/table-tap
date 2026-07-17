"use client";

import { useState } from "react";
import { useAdminActions, type NewUserInput } from "@/hooks/useAdminActions";

interface AdminCreateUserProps {
  restaurantOptions: { id: string; name: string }[];
}

const NEW_RESTAURANT = "__new__";

/** Create any kind of login: admin, founding owner, co-owner, manager, kitchen. */
export default function AdminCreateUser({ restaurantOptions }: AdminCreateUserProps) {
  const { busy, createUser } = useAdminActions();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<NewUserInput["role"]>("kitchen");
  const [restaurantId, setRestaurantId] = useState(restaurantOptions[0]?.id ?? "");
  const [restaurantName, setRestaurantName] = useState("");

  const needsRestaurant = role !== "admin";
  const creatingNew = role === "owner" && restaurantId === NEW_RESTAURANT;

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const ok = await createUser({
      email: email.trim(),
      password,
      role,
      restaurantId: needsRestaurant && !creatingNew ? restaurantId : undefined,
      restaurantName: creatingNew ? restaurantName.trim() : undefined,
    });
    if (ok) {
      setEmail("");
      setPassword("");
      setRestaurantName("");
    }
  }

  return (
    <div className="tt-section" style={{ maxWidth: 560, marginTop: 16 }}>
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          Create a login
        </h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>
          Admins rule the platform; owners can also be founded with a fresh restaurant
        </span>
      </div>

      <form className="tt-prodform" onSubmit={handleSubmit}>
        <div className="tt-prodform-row">
          <input
            className="tt-input"
            style={{ flex: 1 }}
            type="email"
            placeholder="user@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <input
            className="tt-input"
            style={{ flex: 1 }}
            type="password"
            placeholder="Password (8+ characters)"
            minLength={8}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </div>

        <div className="tt-prodform-row">
          <label className="tt-field" style={{ flex: 1 }}>
            <span className="tt-mod-label">Role</span>
            <select
              className="tt-input"
              value={role}
              onChange={e => setRole(e.target.value as NewUserInput["role"])}
            >
              <option value="kitchen">Kitchen</option>
              <option value="waiter">Waiter</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
              <option value="admin">Platform admin</option>
            </select>
          </label>

          {needsRestaurant && (
            <label className="tt-field" style={{ flex: 1.4 }}>
              <span className="tt-mod-label">Restaurant</span>
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
                  <option value={NEW_RESTAURANT}>➕ New restaurant…</option>
                )}
              </select>
            </label>
          )}
        </div>

        {creatingNew && (
          <input
            className="tt-input"
            placeholder="New restaurant name"
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
            {busy ? "Working…" : "+ Create login"}
          </button>
        </div>
      </form>
    </div>
  );
}
