"use client";

import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Restaurant } from "@/lib/types";

type Tile = { href: string; emoji: string; title: string; desc: string; soon?: boolean };

const TILES: Tile[] = [
  { href: "/dashboard/menu", emoji: "📋", title: "Menu", desc: "Add sections, products, add-ons and prices" },
  { href: "#", emoji: "🧾", title: "Orders", desc: "Live incoming orders", soon: true },
  { href: "#", emoji: "🪑", title: "Tables & QR", desc: "Manage tables and print QR codes", soon: true },
];

/** Restaurant dashboard landing — shows the restaurant and links to each area. */
export default function DashboardHome({ restaurant }: { restaurant: Restaurant }) {
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

      <div className="tt-tiles">
        {TILES.map((tile) =>
          tile.soon ? (
            <div key={tile.title} className="tt-tile tt-tile-soon">
              <div className="tt-tile-emoji">{tile.emoji}</div>
              <strong>{tile.title}</strong>
              <span className="tt-muted">{tile.desc}</span>
              <span className="tt-badge" style={{ marginTop: 8 }}>Coming soon</span>
            </div>
          ) : (
            <Link key={tile.title} href={tile.href} className="tt-tile">
              <div className="tt-tile-emoji">{tile.emoji}</div>
              <strong>{tile.title}</strong>
              <span className="tt-muted">{tile.desc}</span>
            </Link>
          )
        )}
      </div>
    </div>
  );
}
