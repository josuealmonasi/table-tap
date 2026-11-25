import type { Metadata } from "next";
import ConfirmTicketEmail from "@/components/tickets/ConfirmTicketEmail.react-component";
import { validToken } from "@/lib/digest-recipients";
import { isLocale } from "@/lib/i18n";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ConfirmTicketEmailPage({ searchParams }: {
  searchParams: Promise<{ t?: string | string[]; lang?: string | string[] }>;
}) {
  const { t, lang } = await searchParams;
  const token = validToken(t) ? t : null;
  return <ConfirmTicketEmail key={token ?? ""} token={token} locale={typeof lang === "string" && isLocale(lang) ? lang : undefined} />;
}
