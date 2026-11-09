"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  const retired = useRef(false);

  useEffect(() => {
    const { data: { subscription } } = createClient().auth.onAuthStateChange((event, session) => {
      const parts = identity?.split(":");
      const current = parts ? privateCacheIdentity(session, parts[2], parts[3]) : null;
      // A new sign-in needs a fresh server membership check. The old layout
      // cannot assign its restaurant or role to the next person at the till.
      const matches = current !== null && current.split(":").slice(0, 4).join(":") === identity;
      if (event === "SIGNED_OUT" || (current !== null && !matches)) retired.current = true;
      setActive(!retired.current && matches);
      // Retiring the cache cleared the navigation and nothing else: a page
      // signed out in another tab stayed mounted and readable, account
      // statement and all (sweep 3, finding 1). The whole page goes instead,
      // to the sign-in screen or to a fresh server check of the new login.
      if (retired.current && window.location.pathname.startsWith("/dashboard")) {
        if (event === "SIGNED_OUT") window.location.assign("/login");
        else window.location.reload();
      }
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
