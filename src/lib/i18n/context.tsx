"use client";

import { createContext, useContext, useMemo } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LOCALE, LOCALE_COOKIE, messagesFor, translate, type Locale } from "./index";

type TFunction = (key: string, vars?: Record<string, string | number>) => string;

interface LocaleValue {
  locale: Locale;
  t: TFunction;
  setLocale: (next: Locale) => void;
}

const LocaleContext = createContext<LocaleValue | null>(null);

/**
 * Provides the active locale + a t() translator to the customer screens. The
 * server reads the locale cookie and passes it in; switching writes the cookie
 * and refreshes so the server re-renders in the new language (URLs unchanged).
 */
export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const value = useMemo<LocaleValue>(() => {
    const messages = messagesFor(locale);
    return {
      locale,
      t: (key, vars) => translate(messages, key, vars),
      setLocale: (next) => {
        document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      },
    };
  }, [locale, router]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** The translator. Outside a provider it echoes the key (dev-only situation). */
export function useT(): TFunction {
  return useContext(LocaleContext)?.t ?? ((key) => key);
}

/** The current locale + a setter for the language toggle. */
export function useLocale(): { locale: Locale; setLocale: (next: Locale) => void } {
  const ctx = useContext(LocaleContext);
  return {
    locale: ctx?.locale ?? DEFAULT_LOCALE,
    setLocale: ctx?.setLocale ?? (() => {}),
  };
}
