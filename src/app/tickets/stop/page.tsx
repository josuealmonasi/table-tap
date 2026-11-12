import type { Metadata } from "next";
import StopTicketEmail from "@/components/tickets/StopTicketEmail.react-component";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function StopTicketEmailPage({ searchParams }: {
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const { t } = await searchParams;
  return <StopTicketEmail key={typeof t === "string" ? t : ""} token={typeof t === "string" ? t : null} />;
}
