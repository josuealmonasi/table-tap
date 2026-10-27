// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DashboardCache from "@/components/layout/DashboardCache.react-component";
import OrdersTakings, { ordersTakingsChanged } from "@/components/dashboard/OrdersTakings";

const auth = vi.hoisted(() => ({ callback: null as null | ((event: string, session: null) => void) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {
  onAuthStateChange: (callback: typeof auth.callback) => {
    auth.callback = callback;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  },
} }) }));
let root: Root;
let container: HTMLDivElement;
const answer = (restaurantId = "r1", currency = "MXN", collectedToday = 50) =>
  new Response(JSON.stringify({ restaurantId, currency, collectedToday }));
async function render(restaurantId = "r1", currency = "MXN", identity: string | null = "user:session:r1:manager") {
  await act(async () => root.render(<DashboardCache identity={identity}>
    <OrdersTakings restaurantId={restaurantId} currency={currency} initialCollected={10} />
  </DashboardCache>));
}
async function refresh() {
  await act(async () => ordersTakingsChanged("r1"));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => answer()));
  container = document.createElement("div"); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each([
  ["r2", "USD"], ["r2", "MXN"], ["r1", "USD"],
])("keeps the last good figure when membership answers for %s/%s", async (restaurantId, currency) => {
  await render(); await refresh();
  expect(container.textContent).toContain("50.00");
  vi.mocked(fetch).mockResolvedValueOnce(answer(restaurantId, currency, 250));
  await refresh();
  expect(container.textContent).toContain("50.00");
  expect(container.textContent).not.toContain("250");
  vi.mocked(fetch).mockResolvedValueOnce(answer("r1", "MXN", 75));
  await refresh();
  expect(container.textContent).toContain("75.00");
});
it("does not reuse an MXN figure after the same board changes currency", async () => {
  await render(); await refresh();
  await render("r1", "USD");
  expect(container.textContent).toContain("10.00");
  expect(container.textContent).not.toContain("50.00");
});
it.each([NaN, Infinity, "50", null])("rejects a malformed collected amount %s", async collectedToday => {
  await render(); await refresh();
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ restaurantId: "r1", currency: "MXN", collectedToday })));
  await refresh();
  expect(container.textContent).toContain("50.00");
});
it("keeps a late answer in the retired session's cache", async () => {
  let reply!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
  await render(); await refresh();
  await render("r2", "USD", "other:session:r2:manager");
  await act(async () => reply(answer("r1", "MXN", 250)));
  expect(container.textContent).toContain("10.00");
  expect(container.textContent).not.toContain("250");
});
