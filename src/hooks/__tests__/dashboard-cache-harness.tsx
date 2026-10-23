import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import DashboardCache from "@/components/layout/DashboardCache.react-component";
import { useBadges } from "@/hooks/useBadges";
import { useNotifications } from "@/hooks/useNotifications";

const auth = vi.hoisted(() => ({
  callback: null as null | ((event: AuthChangeEvent, session: Session | null) => void),
  unsubscribe: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {
  onAuthStateChange: (callback: typeof auth.callback) => {
    auth.callback = callback;
    return { data: { subscription: { unsubscribe: auth.unsubscribe } } };
  },
} }) }));

export const identity = "user:session:restaurant:owner:9999999999";
export const notice = { id: "n1", kind: "low_stock" as const, data: { name: "Soup" }, read_at: null, created_at: "2026-10-23" };
export const calls = vi.fn<typeof fetch>();
export const latest: { badges: Record<string, number>; bell: ReturnType<typeof useNotifications> }[] = [];
let root: Root;

function Probe({ index, enabled }: { index: number; enabled: boolean }): React.ReactNode {
  latest[index] = { badges: useBadges(), bell: useNotifications(enabled) };
  return null;
}

export function answer(unread = 2, count = 7): void {
  calls.mockImplementation(async url => new Response(JSON.stringify(String(url).includes("badges")
    ? { badges: { "/dashboard/orders": count } }
    : { notifications: [notice], unread }), { status: 200 }));
}

export async function render(scope: string | null = identity, count = 1, enabled = true): Promise<void> {
  await act(async () => {
    root.render(<DashboardCache identity={scope}>
      {Array.from({ length: count }, (_, index) => <Probe key={index} index={index} enabled={enabled} />)}
    </DashboardCache>);
  });
}

export async function advance(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

export async function emit(event: AuthChangeEvent, user = "user", session = "session"): Promise<void> {
  const value = event === "SIGNED_OUT" ? null : {
    user: { id: user }, expires_at: Math.floor(Date.now() / 1000) + 3600,
    access_token: `header.${btoa(JSON.stringify({ session_id: session, exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`,
  } as Session;
  await act(async () => auth.callback!(event, value));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", calls);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.spyOn(Math, "random").mockReturnValue(0);
  calls.mockReset(); answer(); latest.length = 0;
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
