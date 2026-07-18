"use client";

import { useLocale, useT } from "@/lib/i18n/context";

/** A small EN/ES switch. `className` lets it restyle for light (nav) backgrounds. */
export default function LanguageToggle({
  className = "tt-lang-toggle",
}: {
  className?: string;
}) {
  const { locale, setLocale } = useLocale();
  const t = useT();
  return (
    <button
      type="button"
      className={className}
      aria-label={t("lang.label")}
      onClick={() => setLocale(locale === "es" ? "en" : "es")}
    >
      {t("lang.toggle")}
    </button>
  );
}
