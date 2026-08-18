import type { Metadata } from "next";
import LegalDoc from "@/components/legal/LegalDoc";
import { TERMS_ES, TERMS_ES_META } from "@/lib/legal/terms-es";

export const metadata: Metadata = { title: "Términos y Condiciones · TableTap" };

// /terminos — public, and reachable without an account: somebody deciding
// whether to sign up has to be able to read what they would be agreeing to.
export default function TermsPage() {
  return (
    <LegalDoc
      title={TERMS_ES_META.title}
      intro={TERMS_ES_META.intro}
      version={TERMS_ES_META.version}
      clauses={TERMS_ES}
    />
  );
}
