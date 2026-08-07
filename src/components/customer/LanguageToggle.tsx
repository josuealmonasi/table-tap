"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useT } from "@/lib/i18n/context";
import { LOCALES, LOCALE_LABELS } from "@/lib/i18n";
import { CheckIcon, ExpandIcon } from "@/components/ui/icons";

/**
 * Language switcher: a button showing the current language that opens a dropdown
 * to pick another. Modeled on the account menu so it scales past two languages.
 * `className` restyles the button for light (nav) vs dark (menu header) backgrounds.
 */
export default function LanguageToggle({
  className = "tt-lang-toggle",
}: {
  className?: string;
}) {
  const { locale, setLocale } = useLocale();
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = LOCALE_LABELS[locale];

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="tt-lang" ref={ref}>
      <button
        type="button"
        className={className}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t("lang.label")}
        onClick={() => setOpen(o => !o)}
      >
        {current.flag} {current.short}
        <span className="tt-lang-caret" aria-hidden="true">
          <ExpandIcon size={11} weight="bold" />
        </span>
      </button>

      {open && (
        <div className="tt-lang-menu" role="menu">
          {LOCALES.map(code => {
            const l = LOCALE_LABELS[code];
            const active = code === locale;
            return (
              <button
                key={code}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={`tt-lang-option ${active ? "tt-lang-option-active" : ""}`}
                onClick={() => {
                  setOpen(false);
                  if (!active) setLocale(code);
                }}
              >
                <span>
                  {l.flag} {l.name}
                </span>
                {active && <CheckIcon size={14} weight="bold" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
