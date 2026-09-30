import type { Metadata } from "next";
import AccountStatement from "@/components/accounts/AccountStatement";
import { normalizeCode } from "@/lib/accounts";

export const dynamic = "force-dynamic";

// The code in the address is the account's key; a search engine that kept one
// would be publishing somebody's tab.
export const metadata: Metadata = { robots: { index: false, follow: false } };

// /cuenta/<code> — a customer's statement, opened from its QR: what their
// account owes and the way to pay it, online or at the till.
export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ paid?: string }>;
}) {
  const { code } = await params;
  const { paid } = await searchParams;
  return (
    <div className="tt-login">
      <div className="container">
        <AccountStatement code={normalizeCode(code) ?? code} paid={paid === "1"} />
      </div>
    </div>
  );
}
