import Link from "next/link";

export default function Home() {
  return (
    <main className="tt-landing">
      <div className="tt-landing-inner">
        <div style={{ fontSize: 48 }}>🌸</div>
        <h1 className="tt-serif tt-landing-title">TableTap</h1>
        <p className="tt-landing-sub">
          Scan a QR at your table, browse the menu, customise your order, and pay —
          all from your phone. No app, no waiting.
        </p>
        <div className="tt-landing-actions">
          <Link className="tt-btn tt-btn-primary tt-btn-lg" href="/dashboard">
            Restaurant Dashboard →
          </Link>
        </div>
        <p className="tt-muted" style={{ fontSize: 13, marginTop: 24 }}>
          Customers reach their menu via a table QR link like{" "}
          <code>/r/&lt;restaurantId&gt;/t/&lt;tableId&gt;</code>
        </p>
      </div>
    </main>
  );
}
