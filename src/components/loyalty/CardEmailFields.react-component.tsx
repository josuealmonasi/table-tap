"use client";

import { useT } from "@/lib/i18n/context";

interface CardEmailFieldsProps {
  email: string;
  consent: boolean;
  onEmail: (email: string) => void;
  onConsent: (consent: boolean) => void;
  diner?: boolean;
  optional?: boolean;
}

export default function CardEmailFields({ email, consent, onEmail, onConsent, diner = false, optional = false }: CardEmailFieldsProps) {
  const t = useT();
  return <>
    <label className="tt-field">
      <span className="tt-mod-label">{t("cardEmail.label")} {optional && <span className="tt-muted">{t("common.optional")}</span>}</span>
      <input className="tt-input" type="email" autoComplete={diner ? "email" : "off"} maxLength={254}
        value={email} onChange={e => { onEmail(e.target.value); onConsent(false); }} />
    </label>
    <label className="tt-check">
      <input type="checkbox" checked={consent} onChange={e => onConsent(e.target.checked)} />
      <span>{t(diner ? "cardEmail.dinerConsent" : "cardEmail.staffConsent")}</span>
    </label>
    <a className="tt-accent" href="/privacidad" target="_blank" rel="noreferrer">{t("cardEmail.privacy")}</a>
  </>;
}
