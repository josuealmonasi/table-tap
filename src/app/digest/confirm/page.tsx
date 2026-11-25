import type { Metadata } from "next";
import DigestLinkAction from "@/components/digest/DigestLinkAction.react-component";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function DigestConfirmPage({ searchParams }: {
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const { t } = await searchParams;
  const token = typeof t === "string" ? t : null;
  return <DigestLinkAction key={token ?? ""} kind="confirm" token={token} />;
}
