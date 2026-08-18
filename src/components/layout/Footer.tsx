"use client";

import { PRIVACY_PATH } from "@/lib/legal";
import { useT } from "@/lib/i18n/context";

/** Generic site footer, shown on every page. */
export default function Footer() {
  const t = useT();
  return (
    <footer className="tt-footer">
      <div className="container tt-footer-inner">
        <span className="tt-footer-brand">🍴 TableTap</span>
        <span>
          © {new Date().getFullYear()} TableTap. {t("footer.rights")}{" "}
          {/* One link, no banner, nothing to dismiss. Mexican law wants a
              privacy notice available to anyone whose data is handled, and a
              diner who is hungry should be able to ignore it completely —
              a consent wall between somebody and their dinner is how you get
              a closed tab instead of an order. */}
          <a className="tt-footer-legal" href={PRIVACY_PATH} target="_blank" rel="noreferrer">
            {t("footer.privacy")}
          </a>
        </span>
      </div>
    </footer>
  );
}
