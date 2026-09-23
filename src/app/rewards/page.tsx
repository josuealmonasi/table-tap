import type { Metadata } from "next";
import RewardsLookup from "@/components/rewards/RewardsLookup";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";

export const dynamic = "force-dynamic";

// A card's code in the address bar is the card itself; a search engine that
// kept one would be publishing somebody's card.
export const metadata: Metadata = { robots: { index: false, follow: false } };

// /rewards — a diner checks their visit card by the code printed on it. The
// card's QR opens this with the code filled in (?c=…), so pointing a phone's
// camera at your own card shows where it stands.
export default async function RewardsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const { c } = await searchParams;
  return (
    <ConfirmProvider>
      <RewardsLookup initialCode={typeof c === "string" ? c : ""} />
    </ConfirmProvider>
  );
}
