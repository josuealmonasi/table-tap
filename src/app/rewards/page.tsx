import type { Metadata } from "next";
import RewardsLookup from "@/components/rewards/RewardsLookup";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";

export const dynamic = "force-dynamic";

// A card's code in the address bar is the card itself; a search engine that
// kept one would be publishing somebody's card.
export const metadata: Metadata = { robots: { index: false, follow: false } };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MENU_PATH = new RegExp(`^/r/${UUID}(/t/${UUID})?$`);

/**
 * The menu the diner came from, when `back` is one. Anything else is dropped:
 * a link that sent people wherever its query said would be an open redirect
 * with the restaurant's card page in front of it.
 */
function menuPath(back: unknown): string | null {
  return typeof back === "string" && MENU_PATH.test(back) ? back : null;
}

// /rewards — a diner checks their visit card by the code printed on it. The
// card's QR opens this with the code filled in (?c=…), so pointing a phone's
// camera at your own card shows where it stands.
export default async function RewardsPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; back?: string }>;
}) {
  const { c, back } = await searchParams;
  return (
    <ConfirmProvider>
      <RewardsLookup initialCode={typeof c === "string" ? c : ""} back={menuPath(back)} />
    </ConfirmProvider>
  );
}
