"use client";

import { useT } from "@/lib/i18n/context";

/** Generic site footer, shown on every page. */
export default function Footer() {
  const t = useT();
  return (
    <footer className="tt-footer">
      <div className="container tt-footer-inner">
        <span className="tt-footer-brand">🍴 TableTap</span>
        <span>
          © {new Date().getFullYear()} TableTap. {t("footer.rights")}
        </span>
      </div>
    </footer>
  );
}
