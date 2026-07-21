import Link from "next/link";
import { getLocale } from "@/lib/i18n/server";
import { messagesFor, translate } from "@/lib/i18n";

export default async function Home() {
  const m = messagesFor(await getLocale());
  const t = (key: string) => translate(m, key);
  return (
    <main className="tt-landing">
      <div className="container">
        <div className="tt-landing-inner">
          <div style={{ fontSize: 48 }}>🌸</div>
          <h1 className="tt-serif tt-landing-title">TableTap</h1>
          <p className="tt-landing-sub">{t("landing.tagline")}</p>
          <div className="tt-landing-actions">
            <Link className="tt-btn tt-btn-primary tt-btn-lg" href="/login">
              {t("landing.login")}
            </Link>
          </div>
          <p className="tt-muted" style={{ fontSize: 13, marginTop: 24 }}>
            {t("landing.qrHint")}{" "}
            <code>/r/&lt;restaurantId&gt;/t/&lt;tableId&gt;</code>
          </p>
        </div>
      </div>
    </main>
  );
}
