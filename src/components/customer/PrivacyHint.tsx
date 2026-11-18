"use client";

import { PRIVACY_PATH } from "@/lib/legal";
import { useT } from "@/lib/i18n/context";

interface PrivacyHintProps {
  /** What the field collects: the receipt email or the pickup name. */
  field: "email" | "name";
}

/** One line under a field that collects personal data, with the notice behind a link. */
export default function PrivacyHint({ field }: PrivacyHintProps) {
  const t = useT();
  return (
    <p className="tt-privacy-hint">
      {t(`privacyHint.${field}`)}{" "}
      <a href={PRIVACY_PATH} target="_blank" rel="noreferrer">{t("privacyHint.link")}</a>
    </p>
  );
}
