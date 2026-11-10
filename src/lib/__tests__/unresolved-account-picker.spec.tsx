import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/hooks/useOpenAccounts", () => ({ useOpenAccounts: () => ({ failed: false, accounts: [{
  id: "a", name: "Ana", status: "open", owed: 0, credit_limit: 1000,
  checkout_until: "2000-01-01T00:00:00Z", payingOnline: true,
}] }) }));
import AccountPicker from "@/components/dashboard/accounts/AccountPicker";
afterEach(() => vi.unstubAllGlobals());
it("shows the durable unconfirmed state after the deadline and still lets a new sale use the account", () => {
  vi.stubGlobal("React", React);
  const html = renderToStaticMarkup(<AccountPicker active amount={100} currency="MXN" onPick={() => {}} />);
  expect(html).toContain("accounts.payingNow"); expect(html).not.toContain("disabled");
});
