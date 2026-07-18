"use client";

import { useLocale } from "@/lib/i18n/context";
import { useT } from "@/lib/i18n/context";

/** A small EN/ES switch for the customer screens. */
export default function LanguageToggle() {
  const { locale, setLocale } = useLocale();
  const t = useT();
  return (
    <button
      type="button"
      className="tt-lang-toggle"
      aria-label={t("lang.label")}
      onClick={() => setLocale(locale === "es" ? "en" : "es")}
    >
      {t("lang.toggle")}
    </button>
  );
}
