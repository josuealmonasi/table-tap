import type { Metadata } from "next";
import LegalDoc from "@/components/legal/LegalDoc";
import { PRIVACY_ES, PRIVACY_ES_META } from "@/lib/legal/privacy-es";

export const metadata: Metadata = { title: "Aviso de Privacidad · TableTap" };

// /privacidad — the notice the LFPDPPP requires, public for the same reason
// the terms are.
export default function PrivacyPage() {
  return (
    <LegalDoc
      title={PRIVACY_ES_META.title}
      intro={PRIVACY_ES_META.intro}
      version={PRIVACY_ES_META.version}
      clauses={PRIVACY_ES}
    />
  );
}
