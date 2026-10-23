"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { SWRConfig, useSWRConfig } from "swr";
import { createClient } from "@/lib/supabase/client";
import { privateCacheIdentity } from "@/lib/private-cache-identity";
import { BADGES_CHANGED } from "@/lib/badge-events";

const DashboardScope = createContext<string | null>(null);

interface CacheProps {
  identity: string | null;
  children: React.ReactNode;
}

/** One in-memory cache per verified user, session, restaurant and role. */
export default function DashboardCache({ identity, children }: CacheProps): React.ReactNode {
  // The offline expiry moves on token refresh; it is not a new identity.
  const scope = identity?.split(":").slice(0, 4).join(":") ?? null;
  return <SessionCache key={scope ?? "signed-out"} identity={scope}>{children}</SessionCache>;
}

function SessionCache({ identity, children }: CacheProps): React.ReactNode {
  const [active, setActive] = useState(identity !== null);

  useEffect(() => {
    const { data: { subscription } } = createClient().auth.onAuthStateChange((_event, session) => {
      const parts = identity?.split(":");
      const current = parts ? privateCacheIdentity(session, parts[2], parts[3]) : null;
      // A new sign-in needs a fresh server membership check. The old layout
      // cannot assign its restaurant or role to the next person at the till.
      setActive(current !== null && current.split(":").slice(0, 4).join(":") === identity);
    });
    return () => subscription.unsubscribe();
  }, [identity]);

  const scope = active ? identity : null;
  return <ScopedCache key={scope ?? "signed-out"} identity={scope}>{children}</ScopedCache>;
}

function ScopedCache({ identity, children }: CacheProps): React.ReactNode {
  // Remounting discards the entire cache, including in-flight reads. A late
  // answer can only reach the retired provider, never the next identity.
  const config = useMemo(() => ({
    provider: () => new Map(),
    refreshInterval: 30_000,
    errorRetryInterval: 30_000,
  }), []);
  return (
    <SWRConfig value={config}>
      <CacheScope identity={identity}>{children}</CacheScope>
    </SWRConfig>
  );
}

function CacheScope({ identity, children }: CacheProps): React.ReactNode {
  const { mutate } = useSWRConfig();
  useEffect(() => {
    // One invalidation per cache, even when several components share a badge.
    const read = () => { void mutate(key => Array.isArray(key) && key[0] === "/api/badges"); };
    window.addEventListener(BADGES_CHANGED, read);
    return () => window.removeEventListener(BADGES_CHANGED, read);
  }, [mutate]);
  return <DashboardScope.Provider value={identity}>{children}</DashboardScope.Provider>;
}

export function useDashboardScope(): string | null {
  return useContext(DashboardScope);
}
