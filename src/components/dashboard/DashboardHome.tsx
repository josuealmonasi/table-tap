import Link from "next/link";
import { NAV_ITEMS } from "@/lib/nav";
import Breadcrumb from "@/components/layout/Breadcrumb";

/** Restaurant dashboard landing — links to each management area. */
export default function DashboardHome() {
  return (
    <div className="tt-dash">
      <div className="container">
        <header className="tt-dash-head">
          <Breadcrumb trail={[{ label: "Dashboard" }]} />
        </header>

        <div className="tt-tiles">
          {NAV_ITEMS.map((tile) =>
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
