"use client";

import { PRIVACY_PATH, TERMS_PATH } from "@/lib/legal";
import { useT } from "@/lib/i18n/context";
import { DownloadIcon } from "@/components/ui/icons";

/**
 * The documents this restaurant agreed to, kept where the agreement lives.
 *
 * Next to the price and the cancel button rather than in Settings: this is the
 * commercial relationship, not a preference, and it is the owner's — Settings
 * is somewhere a manager also works. The line underneath is the part that is
 * actually worth having, and the reason we record a version rather than a
 * boolean: it says which document they accepted and when, which is the
 * question anyone asks months later.
 */
export default function PlanDocuments({
  acceptedVersion,
  acceptedAt,
}: {
  acceptedVersion: string | null;
  acceptedAt: string | null;
}) {
  const t = useT();

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("plan.docsTitle")}
        </h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>
          {t("plan.docsHint")}
        </span>
      </div>

      <div className="tt-doc-list">
        {[
          { href: TERMS_PATH, label: t("auth.termsLink") },
          { href: PRIVACY_PATH, label: t("auth.privacyLink") },
        ].map(doc => (
          <a key={doc.href} className="tt-doc-row" href={doc.href} download>
            <DownloadIcon size={17} weight="bold" aria-hidden="true" />
            <span>{doc.label}</span>
            <span className="tt-muted tt-doc-kind">PDF</span>
          </a>
        ))}
      </div>

      {acceptedVersion && acceptedAt && (
        <p className="tt-muted tt-doc-accepted">
          {t("plan.docsAccepted", {
            version: acceptedVersion,
            date: new Date(acceptedAt).toLocaleDateString([], {
              day: "numeric",
              month: "long",
              year: "numeric",
            }),
          })}
        </p>
      )}
    </div>
  );
}
