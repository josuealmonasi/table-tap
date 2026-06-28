import Link from "next/link";
import type { Restaurant } from "@/lib/types";

type Tile = { href: string; emoji: string; title: string; desc: string; soon?: boolean };

const TILES: Tile[] = [
  { href: "/dashboard/menu", emoji: "📋", title: "Menu", desc: "Add sections, products, extras and prices" },
  { href: "#", emoji: "🧾", title: "Orders", desc: "Live incoming orders", soon: true },
  { href: "#", emoji: "🪑", title: "Tables & QR", desc: "Manage tables and print QR codes", soon: true },
];

/** Restaurant dashboard landing — links to each management area. */
export default function DashboardHome({ restaurant }: { restaurant: Restaurant }) {
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <div>
            <h1 className="tt-serif" style={{ margin: 0 }}>Dashboard</h1>
            <span className="tt-muted" style={{ fontSize: 13 }}>{restaurant.name}</span>
          </div>
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
    </div>
  );
}
