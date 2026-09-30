"use client";

import { useCallback, useEffect, useState } from "react";

/** An account as the staff see it in a list. */
export interface AccountListItem {
  id: string;
  name: string;
  email: string | null;
  code: string;
  credit_limit: number;
  status: "open" | "closed";
  opened_by: string;
  opened_at: string;
  owed: number;
  lastChargeAt: string | null;
  checkout_until: string | null;
}

/**
 * The restaurant's customer accounts, loaded when `active`. A failed read is
 * said as such — not as "no accounts", which would send a cashier to open a
 * second account for somebody who already has one.
 */
export function useOpenAccounts(active: boolean): {
  accounts: AccountListItem[] | null;
  failed: boolean;
  reload: () => void;
} {
  const [accounts, setAccounts] = useState<AccountListItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt(n => n + 1), []);

  useEffect(() => {
    if (!active) return;
    let live = true;
    setFailed(false);
    fetch("/api/accounts")
      .then(async r => {
        if (!r.ok) throw new Error(String(r.status));
        const d = await r.json();
        if (live) setAccounts(d.accounts ?? []);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [active, attempt]);

  return { accounts, failed, reload };
}
