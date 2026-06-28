"use client";

import { createClient } from "@/lib/supabase/client";
import type { Restaurant } from "@/lib/types";

/** Minimal restaurant dashboard — shows the restaurant name and sign-out for now. */
export default function RestaurantDashboard({ restaurant }: { restaurant: Restaurant }) {
  async function signOut() {
    await createClient().auth.signOut();
    window.location.assign("/login");
  }

  return (
    <div className="tt-dash">
      <header className="tt-dash-head">
        <div>
          <h1 className="tt-serif" style={{ margin: 0 }}>{restaurant.logo} {restaurant.name}</h1>
          <span className="tt-muted" style={{ fontSize: 13 }}>Dashboard</span>
        </div>
        <button className="tt-btn tt-btn-ghost" onClick={signOut}>Sign out</button>
      </header>

      <div className="tt-empty">
        <div style={{ fontSize: 48 }}>🍽️</div>
        <strong>Welcome, {restaurant.name}</strong>
        <p className="tt-muted">
          Your dashboard is ready. Live orders, menu management and table QR codes are coming next.
        </p>
      </div>
    </div>
  );
}
